import { describe, expect, it, vi } from "vitest";

import { MissingScopeError } from "../../src/errors/errors";
import { type CreateFakeOptions, createFakeTrading212, type FakeAccountState } from "../../src/testing";
import type { WatchErrorEvent, Watcher } from "../../src/watcher";

const limit = { ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 1, timeValidity: "DAY" } as const;

/** Runs a watcher in the background, keeping every event, until the test stops it. */
function record<E extends { readonly type: string }>(watcher: Watcher<E>) {
	const events: (E | WatchErrorEvent)[] = [];
	const done = (async () => {
		for await (const event of watcher) events.push(event);
	})();
	return { events, done };
}

function fake(state: FakeAccountState = {}, options: CreateFakeOptions["client"] = {}) {
	const { client, server } = createFakeTrading212({ state, client: options });
	/** Resolves once the watcher has made its first check, which only records where things stand. */
	const started = async (requests: number) =>
		vi.waitFor(() => {
			expect(server.requests.length).toBeGreaterThanOrEqual(requests);
		});
	return { client, server, started };
}

describe("watch.orders", () => {
	it("reports orders placed, filled and cancelled, including market orders that fill at once", async () => {
		const { client, server, started } = fake({ cash: 5000 });
		const before = await client.orders.limit(limit);
		const watcher = client.watch.orders({ intervalMs: 5 });
		const { events, done } = record(watcher);
		await started(3);
		expect(events).toEqual([]);

		const market = await client.orders.buy({ ticker: "MSFT_US_EQ", quantity: 1 });
		await vi.waitFor(() => {
			expect(events).toEqual([
				{
					type: "filled",
					order: expect.objectContaining({ id: market.id }),
					fill: expect.objectContaining({ price: 420 }),
				},
			]);
		});
		const pending = await client.orders.limit(limit);
		await vi.waitFor(() => {
			expect(events.at(-1)).toEqual({ type: "placed", order: expect.objectContaining({ id: pending.id }) });
		});
		server.fill(before.id ?? 0);
		await client.orders.cancel(pending.id ?? 0);
		await vi.waitFor(() => {
			expect(events.slice(2).map((event) => [event.type, "order" in event && event.order.id])).toEqual(
				expect.arrayContaining([
					["filled", before.id],
					["cancelled", pending.id],
				]),
			);
		});
		watcher.stop();
		await done;
		expect(events).toHaveLength(4);
	});

	it("reports a pending order that changes, and one that leaves without the history saying how", async () => {
		const { client, server, started } = fake();
		const order = await client.orders.limit(limit);
		const other = await client.orders.limit({ ...limit, quantity: 2 });
		const watcher = client.watch.orders({ intervalMs: 5 });
		const { events, done } = record(watcher);
		await started(4);
		const listed = server.pending.get(order.id ?? 0);
		if (listed) listed.order = { ...listed.order, status: "PARTIALLY_FILLED", filledQuantity: 0.5 };
		await vi.waitFor(() => {
			expect(events).toEqual([
				expect.objectContaining({ type: "updated", order: expect.objectContaining({ filledQuantity: 0.5 }) }),
			]);
		});
		server.pending.delete(other.id ?? 0);
		await vi.waitFor(() => {
			expect(events.at(-1)).toEqual({ type: "gone", order: expect.objectContaining({ id: other.id }) });
		});
		// Each check looked the missing order up by its ticker before giving up on it.
		expect(server.requests.filter((request) => request.query.ticker === "AAPL_US_EQ").length).toBeGreaterThan(3);
		watcher.stop();
		await done;
	});

	/** An order the pending list leaves out for one check is still the same order when it comes back. */
	it("does not report an order as placed again when it is missing from one check", async () => {
		const { client, server, started } = fake();
		const order = await client.orders.limit(limit);
		const watcher = client.watch.orders({ intervalMs: 20 });
		const { events, done } = record(watcher);
		await started(2);
		const checks = () => server.requests.filter((request) => request.path.endsWith("/equity/orders")).length;
		const entry = server.pending.get(order.id ?? 0);
		server.pending.delete(order.id ?? 0);
		const before = checks();
		await vi.waitFor(
			() => {
				expect(checks()).toBe(before + 1);
			},
			{ interval: 1 },
		);
		if (entry) server.pending.set(order.id ?? 0, entry);
		await vi.waitFor(() => {
			expect(checks()).toBeGreaterThan(before + 3);
		});
		watcher.stop();
		await done;
		expect(events).toEqual([]);
	});

	it("stops, and throws from the loop, when the key cannot read the history", async () => {
		const { client, server } = fake();
		server.failNext("listHistoricalOrders", {
			status: 403,
			body: { type: "/api-errors/forbidden", title: "Missing Scope(history:orders)", status: 403 },
		});
		const watcher = client.watch.orders({ intervalMs: 5 });
		const errors: WatchErrorEvent[] = [];
		watcher.on("error", (event) => {
			errors.push(event);
		});
		await expect(record(watcher).done).rejects.toBeInstanceOf(MissingScopeError);
		expect(errors).toEqual([expect.objectContaining({ willRetry: false })]);
		expect(watcher.stopped).toBe(true);
	});

	it("reports a check that failed and carries on", async () => {
		const { client, server, started } = fake({}, { retry: false });
		const watcher = client.watch.orders({ intervalMs: 5 });
		const { events, done } = record(watcher);
		await started(2);
		server.failNext("listOrders", { status: 503, body: {} });
		await vi.waitFor(() => {
			expect(events).toEqual([expect.objectContaining({ type: "error", willRetry: true })]);
		});
		const order = await client.orders.limit(limit);
		await vi.waitFor(() => {
			expect(events.at(-1)).toEqual({ type: "placed", order: expect.objectContaining({ id: order.id }) });
		});
		watcher.stop();
		await done;
	});
});

describe("watch.positions", () => {
	it("reports positions opened, resized and closed, and ignores price moves", async () => {
		const { client, server, started } = fake({ positions: [{ ticker: "AAPL_US_EQ", quantity: 2 }] });
		const watcher = client.watch.positions({ intervalMs: 5 });
		const { events, done } = record(watcher);
		await started(1);
		server.setPrice("AAPL_US_EQ", 999);
		await client.orders.buy({ ticker: "MSFT_US_EQ", quantity: 1 });
		await vi.waitFor(() => {
			expect(events.map((event) => event.type)).toEqual(["opened"]);
		});
		await client.orders.sell({ ticker: "AAPL_US_EQ", quantity: 1 });
		await vi.waitFor(() => {
			expect(events.at(-1)).toMatchObject({ type: "changed", position: { quantity: 1 }, previous: { quantity: 2 } });
		});
		await client.orders.sellAll("AAPL_US_EQ");
		await vi.waitFor(() => {
			expect(events.at(-1)).toMatchObject({ type: "closed", position: { instrument: { ticker: "AAPL_US_EQ" } } });
		});
		watcher.stop();
		await done;
		expect(events).toHaveLength(3);
	});
});

describe("watch.cash", () => {
	it("reports cash moving, with the summary it came from", async () => {
		const { client, server, started } = fake({ cash: 100 });
		const controller = new AbortController();
		const watcher = client.watch.cash({ intervalMs: 5, signal: controller.signal });
		const heard: unknown[] = [];
		watcher.on("changed", (event) => {
			heard.push(event);
		});
		await started(1);
		server.cash = 150;
		await vi.waitFor(() => {
			expect(heard).toEqual([
				{
					type: "changed",
					cash: expect.objectContaining({ availableToTrade: 150 }),
					previous: expect.objectContaining({ availableToTrade: 100 }),
					summary: expect.objectContaining({ totalValue: 150 }),
				},
			]);
		});
		controller.abort();
		expect(watcher.stopped).toBe(true);
	});

	it("refuses an interval that is not a duration", () => {
		const { client } = fake();
		expect(() => client.watch.cash({ intervalMs: 0 })).toThrow("intervalMs");
	});
});
