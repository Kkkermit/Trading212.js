import { describe, expect, it } from "vitest";

import {
	NotFoundError,
	OrderOutcomeUnknownError,
	OrderRejectedError,
	TimeoutError,
	ValidationError,
} from "../../src/errors/errors";
import { createFakeTrading212 } from "../../src/testing";

import { hangingFetch, scripted } from "../helpers";

describe("orders", () => {
	it("buys and sells with the sign set for you", async () => {
		const { client, server } = createFakeTrading212({ state: { cash: 1000 } });
		await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 2 });
		expect(server.position("AAPL_US_EQ")?.quantity).toBe(2);
		await client.orders.sell({ ticker: "AAPL_US_EQ", quantity: 0.5 });
		expect(server.position("AAPL_US_EQ")?.quantity).toBe(1.5);
		expect(server.requests.at(-1)?.body).toEqual({ ticker: "AAPL_US_EQ", quantity: -0.5 });
	});

	it("places limit, stop and stop-limit orders that wait for a fill", async () => {
		const { client, server } = createFakeTrading212({ state: { positions: [{ ticker: "MSFT_US_EQ", quantity: 5 }] } });
		const limit = await client.orders.buy({
			type: "limit",
			ticker: "AAPL_US_EQ",
			quantity: 1,
			limitPrice: 200,
			timeValidity: "DAY",
		});
		await client.orders.sell({
			type: "stop",
			ticker: "MSFT_US_EQ",
			quantity: 1,
			stopPrice: 400,
			timeValidity: "GOOD_TILL_CANCEL",
		});
		await client.orders.stopLimit({
			ticker: "MSFT_US_EQ",
			quantity: -1,
			stopPrice: 400,
			limitPrice: 395,
			timeValidity: "DAY",
		});
		await client.orders.limit({ ticker: "MSFT_US_EQ", quantity: -1, limitPrice: 500, timeValidity: "DAY" });
		expect((await client.orders.list()).map((order) => order.type)).toEqual(["LIMIT", "STOP", "STOP_LIMIT", "LIMIT"]);
		expect((await client.orders.get(limit.id ?? 0)).status).toBe("NEW");
		expect(server.position("MSFT_US_EQ")?.quantityAvailableForTrading).toBe(2);
		server.fill(limit.id ?? 0);
		await client.orders.cancel((await client.orders.list())[0]?.id ?? 0);
		expect(await client.orders.list()).toHaveLength(2);
	});

	it("checks the order before sending, so a slip costs no request", async () => {
		const { client, server } = createFakeTrading212();
		await expect(client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 0.00001 })).rejects.toBeInstanceOf(
			ValidationError,
		);
		await expect(client.orders.sell({ ticker: "AAPL_US_EQ", quantity: -1 })).rejects.toThrow("must be positive");
		await expect(client.orders.get(-1)).rejects.toThrow("positive whole number");
		await expect(client.orders.cancel(1.5)).rejects.toBeInstanceOf(ValidationError);
		expect(server.requests).toHaveLength(0);
	});

	it("turns Trading 212's refusals into named errors", async () => {
		const { client, server } = createFakeTrading212({ state: { cash: 10 } });
		await expect(client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 })).rejects.toMatchObject({
			reason: "insufficient-free-for-stocks-buy",
		});
		await expect(client.orders.sell({ ticker: "TSLA_US_EQ", quantity: 1 })).rejects.toMatchObject({
			reason: "selling-equity-not-owned",
			ownedQuantity: 0,
			message: "POST /api/v0/equity/orders/market was refused: it sells 1 TSLA_US_EQ, but the account owns 0.",
		});
		server.marketOpen = false;
		await expect(client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 0.01 })).rejects.toBeInstanceOf(
			OrderRejectedError,
		);
	});

	it("previews an order with dryRun, without sending it", async () => {
		const { client, server } = createFakeTrading212({ environment: "live", client: { trading: "disabled" } });
		const preview = await client.orders.buy(
			{ type: "limit", ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 199.5, timeValidity: "DAY" },
			{ dryRun: true },
		);
		expect(preview).toEqual({
			dryRun: true,
			method: "POST",
			url: "https://live.trading212.com/api/v0/equity/orders/limit",
			endpoint: "placeLimitOrder",
			body: { ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 199.5, timeValidity: "DAY" },
			wouldSend: false,
		});
		expect(server.requests).toHaveLength(0);
	});

	/** Positions can hold 8 decimal places but orders take 4; selling "everything" must not exceed what is held. */
	it("sells everything available, truncated to 4 decimal places", async () => {
		const { client, server } = createFakeTrading212({
			state: { positions: [{ ticker: "AAPL_US_EQ", quantity: 3.12345678, inPies: 1 }] },
		});
		const order = await client.orders.sellAll("AAPL_US_EQ", { extendedHours: true });
		expect(order.status).toBe("NEW");
		expect(server.requests.at(-1)?.body).toEqual({ ticker: "AAPL_US_EQ", quantity: -2.1234, extendedHours: true });
		expect(server.position("AAPL_US_EQ")?.quantity).toBe(1.00005678);
		// What is left (0.00005678 outside pies) is below the smallest quantity an order can carry.
		await expect(client.orders.sellAll("AAPL_US_EQ", { dryRun: true })).rejects.toThrow("None of your AAPL_US_EQ");
		const fresh = createFakeTrading212({ state: { positions: [{ ticker: "AAPL_US_EQ", quantity: 0.00015 }] } });
		const preview = await fresh.client.orders.sellAll("AAPL_US_EQ", { dryRun: true });
		expect(preview.body).toEqual({ ticker: "AAPL_US_EQ", quantity: -0.0001 });
	});

	it("explains when there is nothing to sell", async () => {
		const { client } = createFakeTrading212({
			state: { positions: [{ ticker: "AAPL_US_EQ", quantity: 1, inPies: 1 }] },
		});
		await expect(client.orders.sellAll("TSLA_US_EQ")).rejects.toThrow("You hold no TSLA_US_EQ");
		await expect(client.orders.sellAll("AAPL_US_EQ")).rejects.toThrow("None of your AAPL_US_EQ is available");
	});

	it("waits for a market order to fill, finding it in the history once it stops being pending", async () => {
		const { client } = createFakeTrading212();
		const order = await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 });
		expect(order.status).toBe("NEW");
		const settled = await client.orders.waitFor(order);
		expect(settled.status).toBe("FILLED");
		expect((await client.orders.waitFor(settled.id ?? 0)).status).toBe("FILLED");
	});

	it("returns a pending order once it reaches a final state", async () => {
		const { client, server } = createFakeTrading212();
		const order = await client.orders.limit({ ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 1, timeValidity: "DAY" });
		const pending = server.pending.get(order.id ?? 0);
		if (pending) pending.order.status = "REJECTED";
		expect((await client.orders.waitFor(order.id ?? 0)).status).toBe("REJECTED");
	});

	it("gives up waiting after its timeout, and passes other errors through", async () => {
		const { client } = createFakeTrading212();
		const order = await client.orders.limit({ ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 1, timeValidity: "DAY" });
		await expect(client.orders.waitFor(order, { timeoutMs: 30, intervalMs: 10 })).rejects.toBeInstanceOf(TimeoutError);
		const missing = createFakeTrading212();
		await expect(missing.client.orders.waitFor(424242, { timeoutMs: 5, intervalMs: 10 })).rejects.toThrow("pending");
		const broken = scripted([{ status: 401 }]);
		await expect(broken.client.orders.waitFor(5)).rejects.not.toBeInstanceOf(NotFoundError);
	});

	/** History allows 20 requests a minute, so a gone order must not keep costing a getOrder as well. */
	it("asks only the history once the pending order has gone", async () => {
		const notFound = { status: 404, body: { code: "OrderNotFound" } };
		const empty = { body: { items: [], nextPagePath: null } };
		const found = { body: { items: [{ order: { id: 7, status: "FILLED" } }], nextPagePath: null } };
		const { client, requests } = scripted([notFound, empty, found]);
		await expect(client.orders.waitFor(7, { intervalMs: 1 })).resolves.toMatchObject({ status: "FILLED" });
		expect(requests.map((request) => request.path)).toEqual([
			"/api/v0/equity/orders/7",
			"/api/v0/equity/history/orders",
			"/api/v0/equity/history/orders",
		]);
	});

	it("stops at its deadline even while a request is still waiting", async () => {
		const { client } = scripted([], { fetch: hangingFetch() });
		const started = Date.now();
		await expect(client.orders.waitFor(7, { timeoutMs: 50 })).rejects.toBeInstanceOf(TimeoutError);
		expect(Date.now() - started).toBeLessThan(1000);
	});
});

describe("sellAll without an available quantity", () => {
	/** Falling back to the whole quantity would try to sell shares held in pies. */
	it("refuses rather than guess", async () => {
		const { client, requests } = scripted([
			{ body: [{ instrument: { ticker: "AAPL_US_EQ" }, quantity: 5, quantityInPies: 2 }] },
		]);
		await expect(client.orders.sellAll("AAPL_US_EQ")).rejects.toThrow("did not say how much");
		expect(requests).toHaveLength(1);
	});
});

describe("cancelAll", () => {
	const limit = { ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 1, timeValidity: "DAY" } as const;

	it("cancels every pending order, or one ticker's, and counts an order already gone as done", async () => {
		const { client, server } = createFakeTrading212({ state: { positions: [{ ticker: "MSFT_US_EQ", quantity: 5 }] } });
		const apple = await client.orders.limit(limit);
		await client.orders.limit({ ...limit, quantity: 2 });
		const microsoft = await client.orders.limit({ ...limit, ticker: "MSFT_US_EQ", quantity: -1, limitPrice: 999 });
		server.failNext("cancelOrder", { status: 404, body: { type: "/api-errors/entity-not-found", title: "Not found" } });

		const results = await client.orders.cancelAll({ ticker: "AAPL_US_EQ" });
		expect(results.map(({ status, order }) => [status, order.id])).toEqual([
			["gone", apple.id],
			["requested", expect.any(Number)],
		]);
		expect((await client.orders.list()).map((order) => order.id)).toEqual([apple.id, microsoft.id]);
		expect((await client.orders.cancelAll()).map((result) => result.status)).toEqual(["requested", "requested"]);
		expect(await client.orders.list()).toEqual([]);
	});

	it("reports a failed cancellation in its result and carries on", async () => {
		const { client, server } = createFakeTrading212();
		await client.orders.limit(limit);
		await client.orders.limit(limit);
		server.failNext("cancelOrder", { status: 500, body: "boom" });
		const [first, second] = await client.orders.cancelAll();
		expect(first).toMatchObject({ status: "failed", error: { code: "outcome_unknown" } });
		expect(second?.status).toBe("requested");
	});

	it("stops before cancelling anything when trading is off", async () => {
		const { client, server } = createFakeTrading212({ client: { trading: "disabled" } });
		server.pending.set(1, { order: { id: 1, ticker: "AAPL_US_EQ" }, reservedCash: 0, reservedShares: 0 });
		await expect(client.orders.cancelAll()).rejects.toMatchObject({ code: "trading_disabled" });
		expect(server.pending.size).toBe(1);
	});
});

describe("findAfterUnknown", () => {
	const buy = { ticker: "AAPL_US_EQ", quantity: 2 } as const;

	/** A market order whose answer was lost: it filled on the fake, but the client saw a dropped connection. */
	async function lostAnswer(fake = createFakeTrading212()) {
		const { client, server } = fake;
		const order = await client.orders.buy(buy);
		server.requests.length = 0;
		const error = new OrderOutcomeUnknownError("lost", {
			request: { method: "POST", path: "/api/v0/equity/orders/market", endpoint: "placeMarketOrder" },
			sent: { ticker: "AAPL_US_EQ", quantity: 2 },
			sentAt: Date.now(),
		});
		return { client, server, order, error };
	}

	it("finds an order that went through, in the history or still pending", async () => {
		const { client, order, error } = await lostAnswer();
		expect(await client.orders.findAfterUnknown(error)).toEqual({
			status: "found",
			where: "history",
			order: expect.objectContaining({ id: order.id, status: "FILLED" }),
		});

		const fake = createFakeTrading212();
		const pending = await fake.client.orders.limit({ ...buy, limitPrice: 1, timeValidity: "DAY" });
		const limitError = new OrderOutcomeUnknownError("timed out", {
			request: { method: "POST", path: "/api/v0/equity/orders/limit", endpoint: "placeLimitOrder" },
			sent: { ...buy, limitPrice: 1, timeValidity: "DAY" },
			sentAt: Date.now(),
		});
		expect(await fake.client.orders.findAfterUnknown(limitError)).toMatchObject({
			status: "found",
			where: "pending",
			order: { id: pending.id },
		});
	});

	it("says there is no sign of an order that never arrived", async () => {
		const { client, error } = await lostAnswer();
		const other = new OrderOutcomeUnknownError("lost", {
			request: error.request ?? { method: "POST", path: "" },
			sent: { ticker: "AAPL_US_EQ", quantity: -2 },
			sentAt: Date.now(),
		});
		expect(await client.orders.findAfterUnknown(other)).toEqual({ status: "not-found" });
	});

	/** Without the time window, an identical order from yesterday would pass for the one that was lost. */
	it("ignores matching orders created long before it was sent", async () => {
		const { client, server, error } = await lostAnswer();
		for (const item of server.orderHistory) {
			if (item.order) item.order.createdAt = new Date(Date.now() - 86_400_000).toISOString();
		}
		expect(await client.orders.findAfterUnknown(error)).toEqual({ status: "not-found" });
	});

	it("cannot tell when several recent orders match", async () => {
		const { client, error } = await lostAnswer();
		await client.orders.buy(buy);
		expect(await client.orders.findAfterUnknown(error)).toMatchObject({
			status: "unclear",
			reason: "2 recent orders match it",
			matches: [{ status: "FILLED" }, { status: "FILLED" }],
		});
	});

	it("cannot tell when the history is too busy to search back far enough", async () => {
		const { client, server, error } = await lostAnswer(createFakeTrading212({ state: { cash: 1_000_000 } }));
		for (let index = 0; index < 200; index++) server.orderHistory.push({ order: { id: index, ticker: "AAPL_US_EQ" } });
		expect(await client.orders.findAfterUnknown(error)).toMatchObject({
			status: "unclear",
			reason: "the history holds too many recent orders to search",
		});
		expect(server.requests.filter((request) => request.path.includes("history"))).toHaveLength(4);
	});

	it("only looks for orders that were placed, and sends nothing", async () => {
		const { client, server } = createFakeTrading212();
		await expect(client.orders.findAfterUnknown(new Error("nope"))).rejects.toBeInstanceOf(ValidationError);
		const cancel = new OrderOutcomeUnknownError("lost", {
			request: { method: "DELETE", path: "/api/v0/equity/orders/1", endpoint: "cancelOrder" },
		});
		await expect(client.orders.findAfterUnknown(cancel)).rejects.toThrow("from cancelOrder");
		await expect(client.orders.findAfterUnknown(new OrderOutcomeUnknownError("lost", {}))).rejects.toThrow(
			"from elsewhere",
		);
		expect(server.requests).toHaveLength(0);
	});

	it("reads only, whatever it finds", async () => {
		const { client, server, error } = await lostAnswer();
		await client.orders.findAfterUnknown(error);
		expect(server.requests.map((request) => request.method)).toEqual(["GET", "GET"]);
	});
});

describe("the maxOpenQuantity check", () => {
	it("refuses an order above the cached limit without sending it", async () => {
		const { client, server } = createFakeTrading212({ state: { cash: 10_000_000 } });
		await client.instruments.list();
		server.requests.length = 0;
		await expect(client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 10_001 })).rejects.toMatchObject({
			code: "validation",
			issues: [{ field: "quantity", message: "is more than the maxOpenQuantity of 10000" }],
		});
		await expect(client.orders.sell({ ticker: "AAPL_US_EQ", quantity: 10_001 }, { dryRun: true })).rejects.toThrow(
			"more than the 10000",
		);
		expect(server.requests).toHaveLength(0);
		await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 10_000 });
	});

	it("never downloads the instrument list for it, and lets Trading 212 decide when it is not cached", async () => {
		const { client, server } = createFakeTrading212({ state: { cash: 10_000_000 } });
		await expect(client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 10_001 })).rejects.toMatchObject({
			reason: "max-quantity-exceeded",
			maxQuantity: 10_000,
		});
		expect(server.requests.map((request) => request.path)).toEqual(["/api/v0/equity/orders/market"]);
	});
});
