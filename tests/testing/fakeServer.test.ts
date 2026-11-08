import { describe, expect, it } from "vitest";

import { Trading212 } from "../../src/client";
import { AuthenticationError, OrderOutcomeUnknownError, ServerError } from "../../src/errors/errors";
import { createFakeTrading212, FakeTrading212Server, weekOfSessions } from "../../src/testing";

describe("the fake server", () => {
	it("refuses the wrong credentials like Trading 212 would", async () => {
		const server = new FakeTrading212Server();
		const client = new Trading212({
			environment: "demo",
			apiKey: "wrong-key",
			apiSecret: "wrong-secret",
			fetch: server.fetch,
			rateLimit: "off",
		});
		await expect(client.account.summary()).rejects.toBeInstanceOf(AuthenticationError);
	});

	it("answers unknown routes and other hosts with 404", async () => {
		const { server } = createFakeTrading212();
		expect((await server.fetch("https://demo.trading212.com/api/v0/nothing", {})).status).toBe(404);
		expect((await server.fetch("https://live.trading212.com/api/v0/equity/positions", {})).status).toBe(404);
	});

	it("injects failures, including network ones, one call at a time", async () => {
		const { client, server } = createFakeTrading212({ client: { retry: false } });
		server.failNext("getAccountSummary", { status: 500 }).failNext("placeMarketOrder", { network: "ECONNRESET" });
		await expect(client.account.summary()).rejects.toBeInstanceOf(ServerError);
		await expect(client.account.summary()).resolves.toMatchObject({ currency: "GBP" });
		await expect(client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 })).rejects.toBeInstanceOf(
			OrderOutcomeUnknownError,
		);
		expect(server.position("AAPL_US_EQ")).toBeUndefined();
	});

	it("sends realistic rate-limit headers", async () => {
		const { server } = createFakeTrading212();
		const response = await server.fetch("https://demo.trading212.com/api/v0/equity/account/summary", {});
		expect(response.headers.get("x-ratelimit-limit")).toBe("1");
		expect(response.headers.get("x-ratelimit-period")).toBe("5");
	});

	it("moves prices, averages buys and books realised profit on sells", async () => {
		const { client, server } = createFakeTrading212({ state: { cash: 5000, prices: { AAPL_US_EQ: 100 } } });
		await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 2 });
		server.setPrice("AAPL_US_EQ", 200);
		await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 2 });
		expect(server.position("AAPL_US_EQ")?.averagePricePaid).toBe(150);
		await client.orders.sell({ ticker: "AAPL_US_EQ", quantity: 4 });
		expect(server.position("AAPL_US_EQ")).toBeUndefined();
		expect(server.realisedProfitLoss).toBe(200);
		expect(server.cash).toBe(5200);
		expect(server.priceOf("UNKNOWN")).toBe(100);
	});

	it("refuses what the real API refuses", async () => {
		const { server } = createFakeTrading212();
		const place = (body: unknown, path = "market") =>
			server.fetch(`https://demo.trading212.com/api/v0/equity/orders/${path}`, {
				method: "POST",
				headers: { Authorization: `Basic ${btoa("fake-trading212-key:fake-trading212-secret")}` },
				body: JSON.stringify(body),
			});
		expect(await (await place({ ticker: "NOPE", quantity: 1 })).json()).toMatchObject({
			type: "/api-errors/instrument-not-found",
		});
		expect((await place({ ticker: "AAPL_US_EQ", quantity: 0 })).status).toBe(400);
		expect(await (await place({ ticker: "AAPL_US_EQ", quantity: 0.12345 })).json()).toMatchObject({
			type: "/api-errors/quantity-precision-mismatch",
		});
		expect((await place({})).status).toBe(400);
	});

	/** Users' tests should meet the errors demo really sends, as recorded in fixtures/errors.json. */
	it("answers errors in the shape demo sends", async () => {
		const { server } = createFakeTrading212();
		const call = (path: string, init: RequestInit = {}, authorized = true) =>
			server.fetch(`https://demo.trading212.com/api/v0/equity/${path}`, {
				...init,
				headers: authorized ? { Authorization: `Basic ${btoa("fake-trading212-key:fake-trading212-secret")}` } : {},
			});
		const refused = await call("account/summary", {}, false);
		expect(refused.status).toBe(401);
		expect(await refused.text()).toBe("\n");
		const missing = await call("orders/1");
		expect(await missing.json()).toEqual({
			type: "/api-errors/entity-not-found",
			title: "Requested entity not found",
			status: 404,
			detail: "Order not found",
			traceId: "0".repeat(32),
		});
		const extended = await call("orders/limit", {
			method: "POST",
			body: JSON.stringify({
				ticker: "AAPL_US_EQ",
				quantity: 1,
				limitPrice: 1,
				timeValidity: "DAY",
				extendedHours: true,
			}),
		});
		expect(await extended.json()).toMatchObject({
			type: "/api-errors/invalid-request",
			detail: "Invalid payload",
			traceId: `${"0".repeat(31)}1`,
		});
		expect(await (await call("history/orders?limit=51")).json()).toMatchObject({
			type: "/api-errors/invalid-request",
			detail: "Limit cannot be greater than 50",
		});
	});

	it("fills a pending sell, and refuses to fill an order it does not have", async () => {
		const { client, server } = createFakeTrading212({ state: { positions: [{ ticker: "AAPL_US_EQ", quantity: 2 }] } });
		const order = await client.orders.sell({
			type: "limit",
			ticker: "AAPL_US_EQ",
			quantity: 1,
			limitPrice: 300,
			timeValidity: "DAY",
		});
		expect(server.fill(order.id ?? 0, 310).status).toBe("FILLED");
		expect(server.position("AAPL_US_EQ")?.quantity).toBe(1);
		const stop = await client.orders.stop({ ticker: "AAPL_US_EQ", quantity: 1, stopPrice: 250, timeValidity: "DAY" });
		expect(server.fill(stop.id ?? 0).status).toBe("FILLED");
		expect(() => server.fill(1)).toThrow("no pending order 1");
		await expect(client.orders.cancel(1)).rejects.toMatchObject({ status: 404 });
		await expect(client.orders.get(1)).rejects.toMatchObject({ status: 404 });
	});

	/** The fake checks the library never sends API credentials to a signed download link. */
	it("refuses a report download that carries credentials, or names an unknown report", async () => {
		const { server } = createFakeTrading212({ environment: "live" });
		const withAuth = await server.fetch("https://reports.fake-trading212.invalid/1.csv", {
			headers: { Authorization: "Basic x" },
		});
		expect(withAuth.status).toBe(400);
		expect((await server.fetch("https://reports.fake-trading212.invalid/1.csv", {})).status).toBe(404);
	});

	it("draws a week of weekday sessions", () => {
		const events = weekOfSessions(new Date("2026-11-07T12:00:00Z"), "14:30", "21:00");
		expect(events.every((event) => ![0, 6].includes(new Date(event.date).getUTCDay()))).toBe(true);
		// Saturday: the week starts with the Friday before, so "the last close" is always known.
		expect(events[0]).toEqual({ date: "2026-11-06T14:30:00.000Z", type: "OPEN" });
	});
});
