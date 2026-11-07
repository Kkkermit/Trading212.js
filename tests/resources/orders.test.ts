import { describe, expect, it } from "vitest";

import { NotFoundError, OrderRejectedError, TimeoutError, ValidationError } from "../../src/errors/errors";
import { createFakeTrading212 } from "../../src/testing";

import { scripted } from "../helpers";

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
			reason: "InsufficientFreeForStocksBuy",
		});
		await expect(client.orders.sell({ ticker: "TSLA_US_EQ", quantity: 1 })).rejects.toMatchObject({
			reason: "SellingEquityNotOwned",
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
