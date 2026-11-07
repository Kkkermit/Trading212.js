import { describe, expect, it, vi } from "vitest";

import { CachedLoader, MemoryCache } from "../src/cache";
import { createFakeTrading212 } from "../src/testing";

import { memoryLogger } from "./helpers";

describe("MemoryCache", () => {
	it("forgets entries once they expire", () => {
		vi.useFakeTimers();
		try {
			const cache = new MemoryCache();
			cache.set("a", 1, 1000);
			expect(cache.get("a")).toBe(1);
			vi.advanceTimersByTime(1000);
			expect(cache.get("a")).toBeUndefined();
			cache.set("b", 2, 1000);
			cache.delete("b");
			expect(cache.get("b")).toBeUndefined();
			cache.set("c", 3, 1000);
			cache.clear();
			expect(cache.get("c")).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("CachedLoader", () => {
	it("shares one load between concurrent callers and serves the cache afterwards", async () => {
		const loader = new CachedLoader(new MemoryCache());
		const load = vi.fn(() => Promise.resolve(["value"]));
		const [first, second] = await Promise.all([
			loader.load("k", 1000, false, load),
			loader.load("k", 1000, false, load),
		]);
		expect(first).toBe(second);
		await loader.load("k", 1000, false, load);
		expect(load).toHaveBeenCalledTimes(1);
		await loader.load("k", 1000, true, load);
		expect(load).toHaveBeenCalledTimes(2);
	});

	/** A broken Redis must cost a download, not the call. */
	it("bypasses a cache store that throws, and reports it", async () => {
		const broken = {
			get: () => {
				throw new Error("redis down");
			},
			set: () => Promise.reject(new Error("redis down")),
		};
		const errors: unknown[] = [];
		const loader = new CachedLoader(broken, (error) => errors.push(error));
		await expect(loader.load("k", 1000, false, () => Promise.resolve(42))).resolves.toBe(42);
		expect(errors).toHaveLength(2);
		const quiet = new CachedLoader(broken);
		await expect(quiet.load("k", 1000, false, () => Promise.resolve(1))).resolves.toBe(1);
	});

	it("warns through the client's logger without naming the key", async () => {
		const { lines, logger } = memoryLogger();
		const cache = { get: () => Promise.reject(new Error("redis down")), set: () => undefined };
		const { client } = createFakeTrading212({ client: { cache, logger } });
		await expect(client.instruments.list()).resolves.not.toHaveLength(0);
		expect(lines.filter((line) => line.level === "warn")).toEqual([
			expect.objectContaining({
				level: "warn",
				message: "The cache store failed for the instruments list, so it was bypassed.",
				fields: { error: "redis down" },
			}),
		]);
	});
});

describe("CachedLoader and abort signals", () => {
	/** One caller giving up must not fail everyone else waiting for the same download. */
	it("lets each caller stop waiting without failing the others", async () => {
		const loader = new CachedLoader(new MemoryCache());
		const load = () =>
			new Promise<string>((resolve) => {
				setTimeout(() => {
					resolve("done");
				}, 10);
			});
		const controller = new AbortController();
		const first = loader.load("k", 1000, false, load, controller.signal);
		const second = loader.load("k", 1000, false, load);
		controller.abort(new Error("first gave up"));
		await expect(first).rejects.toThrow("first gave up");
		await expect(second).resolves.toBe("done");
		await expect(loader.load("k", 1000, false, load, AbortSignal.abort(new Error("already")))).rejects.toThrow(
			"already",
		);

		const later = new AbortController();
		const starter = loader.load("j", 1000, false, load);
		const joiner = loader.load("j", 1000, false, load, later.signal);
		later.abort(new Error("joiner gave up"));
		await expect(joiner).rejects.toThrow("joiner gave up");
		await expect(starter).resolves.toBe("done");
	});
});
