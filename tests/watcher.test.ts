import { describe, expect, it, vi } from "vitest";

import { MissingScopeError, NetworkError } from "../src/errors/errors";
import { silentLogger } from "../src/logging/logger";
import { type WatchErrorEvent, Watcher } from "../src/watcher";

import { memoryLogger } from "./helpers";

interface Tick {
	readonly type: "tick";
	readonly n: number;
}

const tick = (n: number): Tick => ({ type: "tick", n });
const missingScope = () => new MissingScopeError("no scope", { scope: "portfolio" });

/** A poll that answers each check from the script, then reports nothing more. */
function scriptedPoll(...steps: (readonly Tick[] | Error)[]) {
	const poll = vi.fn(async () => {
		const step = steps.shift() ?? [];
		if (step instanceof Error) throw step;
		return step;
	});
	return poll;
}

function watcher(poll: ReturnType<typeof scriptedPoll>, signal?: AbortSignal, logger = silentLogger) {
	return new Watcher<Tick>(poll, { intervalMs: 1, signal, logger });
}

async function take(source: Watcher<Tick>, count: number): Promise<(Tick | WatchErrorEvent)[]> {
	const events: (Tick | WatchErrorEvent)[] = [];
	for await (const event of source) {
		events.push(event);
		if (events.length === count) break;
	}
	return events;
}

describe("Watcher", () => {
	it("gives every event to listeners and to a loop, and leaving the loop stops it", async () => {
		const poll = scriptedPoll([tick(1)], [], [tick(2), tick(3)]);
		const source = watcher(poll);
		const heard: number[] = [];
		source.on("tick", ({ n }) => {
			heard.push(n);
		});
		expect((await take(source, 3)).map((event) => (event as Tick).n)).toEqual([1, 2, 3]);
		expect(heard).toEqual([1, 2, 3]);
		expect(source.stopped).toBe(true);
		const calls = poll.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(poll.mock.calls.length).toBe(calls);
	});

	it("reports an error that will pass and carries on", async () => {
		const source = watcher(scriptedPoll(new NetworkError("down", { sent: false }), [tick(1)]));
		const [error, next] = await take(source, 2);
		expect(error).toMatchObject({ type: "error", willRetry: true, error: { code: "network" } });
		expect(next).toEqual(tick(1));
	});

	/** An error that needs a person must not be retried for ever, or the program would look healthy while blind. */
	it("stops on an error that needs you: listeners hear it, a loop throws it, and the logger is told", async () => {
		const { lines, logger } = memoryLogger();
		const source = watcher(scriptedPoll(missingScope()), undefined, logger);
		const errors: WatchErrorEvent[] = [];
		source.on("error", (event) => {
			errors.push(event);
		});
		await expect(take(source, 1)).rejects.toBeInstanceOf(MissingScopeError);
		expect(errors).toEqual([expect.objectContaining({ willRetry: false })]);
		expect(source.stopped).toBe(true);
		expect(lines).toEqual([expect.objectContaining({ level: "warn", message: "The watcher stopped: no scope" })]);
		await expect(take(source, 1)).rejects.toBeInstanceOf(MissingScopeError);
	});

	it("stops on an error that is not the library's, which a retry would only repeat", async () => {
		const source = watcher(scriptedPoll(new TypeError("a bug")));
		await expect(take(source, 1)).rejects.toThrow("a bug");
	});

	it("stops quietly when its signal aborts or stop() is called, ending loops without an error", async () => {
		const controller = new AbortController();
		const poll = scriptedPoll([tick(1)]);
		const source = watcher(poll, controller.signal);
		const loop = take(source, 10);
		await vi.waitFor(() => {
			expect(poll.mock.calls.length).toBeGreaterThanOrEqual(2);
		});
		controller.abort();
		expect(await loop).toEqual([tick(1)]);
		expect(source.stopped).toBe(true);

		const other = watcher(scriptedPoll());
		const otherLoop = take(other, 1);
		other.stop();
		other.stop();
		expect(await otherLoop).toEqual([]);
		expect(await take(other, 1)).toEqual([]);
	});

	it("never checks when its signal has already aborted", () => {
		const poll = scriptedPoll();
		const source = watcher(poll, AbortSignal.abort());
		expect(source.stopped).toBe(true);
		expect(poll).not.toHaveBeenCalled();
	});

	it("skips a listener that throws or rejects, logs it, and keeps calling the others", async () => {
		const { lines, logger } = memoryLogger();
		const source = watcher(scriptedPoll([tick(1)]), undefined, logger);
		const heard: number[] = [];
		source.on("tick", () => {
			throw new Error("listener broke");
		});
		source.on("tick", () => Promise.reject(new Error("async listener broke")));
		const remove = source.on("tick", ({ n }) => {
			heard.push(n);
		});
		await take(source, 1);
		await vi.waitFor(() => {
			expect(lines.map((line) => line.message)).toEqual([
				"A watcher listener threw, so it was skipped: listener broke",
				"A watcher listener threw, so it was skipped: async listener broke",
			]);
		});
		expect(heard).toEqual([1]);
		remove();
		remove();
	});

	it("stops calling a listener once it is removed", async () => {
		const source = watcher(scriptedPoll([tick(1)], [tick(2)]));
		const heard: number[] = [];
		const remove = source.on("tick", ({ n }) => {
			heard.push(n);
			remove();
		});
		await take(source, 2);
		expect(heard).toEqual([1]);
	});
});
