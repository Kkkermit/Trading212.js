import { describe, expect, it } from "vitest";

import { NotFoundError, OrderRejectedError, TimeoutError, ValidationError } from "../src/errors/errors";
import { decimalPlaces, isValidQuantity, truncateQuantity } from "../src/orders/quantity";
import { validateOrder } from "../src/orders/validate";
import { createFakeTrading212 } from "../src/testing";

import { scripted } from "./helpers";

describe("quantities", () => {
	it("counts decimal places, including numbers JavaScript writes with an exponent", () => {
		expect(decimalPlaces(12.09032128)).toBe(8);
		expect(decimalPlaces(5)).toBe(0);
		expect(decimalPlaces(1e-7)).toBe(7);
		expect(decimalPlaces(1.5e-7)).toBe(8);
		expect(decimalPlaces(1e21)).toBe(0);
		expect(decimalPlaces(Number.NaN)).toBeNaN();
	});

	/** Rounding up would try to sell shares you do not have, which Trading 212 refuses. */
	it("truncates towards zero and never rounds up", () => {
		expect(truncateQuantity(12.09032128)).toBe(12.0903);
		expect(truncateQuantity(0.99999999)).toBe(0.9999);
		expect(truncateQuantity(-1.23456)).toBe(-1.2345);
		expect(truncateQuantity(1e-7)).toBe(0);
		expect(truncateQuantity(-1e-7)).toBe(0);
		expect(Object.is(truncateQuantity(-0.00001), 0)).toBe(true);
		expect(truncateQuantity(2.5, 0)).toBe(2);
		expect(truncateQuantity(1.23e21)).toBe(1.23e21);
		expect(truncateQuantity(123.4567, 2)).toBe(123.45);
	});

	it("refuses nonsense", () => {
		expect(() => truncateQuantity(Number.POSITIVE_INFINITY)).toThrow(RangeError);
		expect(() => truncateQuantity(1, -1)).toThrow(RangeError);
		expect(() => truncateQuantity(1, 0.5)).toThrow(RangeError);
	});

	it("says whether Trading 212 will accept a quantity", () => {
		expect(isValidQuantity(0.1234)).toBe(true);
		expect(isValidQuantity(-3)).toBe(true);
		expect(isValidQuantity(0.12345)).toBe(false);
		expect(isValidQuantity(0)).toBe(false);
		expect(isValidQuantity(Number.NaN)).toBe(false);
	});
});

describe("validateOrder", () => {
	const issuesOf = (run: () => void): string[] => {
		try {
			run();
		} catch (error) {
			expect(error).toBeInstanceOf(ValidationError);
			return (error as ValidationError).issues.map((issue) => `${issue.field} ${issue.message}`);
		}
		return [];
	};

	it("accepts a correct order of every type", () => {
		expect(
			issuesOf(() => {
				validateOrder("market", { ticker: "A_US_EQ", quantity: -1.5, extendedHours: true });
			}),
		).toEqual([]);
		expect(
			issuesOf(() => {
				validateOrder("limit", { ticker: "A", quantity: 1, limitPrice: 10, timeValidity: "DAY" });
			}),
		).toEqual([]);
		expect(
			issuesOf(() => {
				validateOrder("stop", { ticker: "A", quantity: 1, stopPrice: 10, timeValidity: "GOOD_TILL_CANCEL" });
			}),
		).toEqual([]);
		expect(
			issuesOf(() => {
				validateOrder("stopLimit", { ticker: "A", quantity: 1, stopPrice: 10, limitPrice: 9, timeValidity: "DAY" });
			}),
		).toEqual([]);
	});

	it("names every problem at once", () => {
		expect(
			issuesOf(() => {
				validateOrder("limit", { ticker: " ", quantity: 0.123456, extendedHours: true });
			}),
		).toEqual([
			"ticker is required",
			"quantity has more than 4 decimal places; use truncateQuantity()",
			"limitPrice is required for a limit order",
			"timeValidity is required for a limit order",
			"extendedHours is only allowed on market orders",
		]);
	});

	it("checks every field's type", () => {
		expect(
			issuesOf(() => {
				validateOrder("stopLimit", {
					ticker: "AAPL US",
					quantity: Number.NaN,
					stopPrice: -1,
					limitPrice: "5",
					timeValidity: "WEEK",
					extendedHours: "yes",
				});
			}),
		).toEqual([
			"ticker must not contain spaces; use the Trading 212 ticker, such as AAPL_US_EQ",
			"quantity must be a finite number",
			"limitPrice must be a positive number",
			"stopPrice must be a positive number",
			'timeValidity must be "DAY" or "GOOD_TILL_CANCEL"',
			"extendedHours must be true or false",
			"extendedHours is only allowed on market orders",
		]);
		expect(
			issuesOf(() => {
				validateOrder("market", { ticker: "A", quantity: 0 });
			}),
		).toEqual(["quantity must not be zero"]);
		expect(
			issuesOf(() => {
				validateOrder("market", { ticker: "A", quantity: -1 }, "positive");
			}),
		).toEqual(["quantity must be positive; buy() and sell() set the sign themselves"]);
		expect(
			issuesOf(() => {
				validateOrder("market", { ticker: "A", quantity: 1, limitPrice: 3 });
			}),
		).toEqual(["limitPrice is not used by a market order"]);
	});
});

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
