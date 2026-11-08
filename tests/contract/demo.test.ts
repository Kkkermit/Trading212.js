// Runs against the real demo API with `npm run test:demo`. It needs T212_DEMO_API_KEY and T212_DEMO_API_SECRET, from
// the shell or .env, is hard-wired to demo, and skips itself without them. It never touches live.
import { beforeAll, describe, expect, it } from "vitest";

import { NotAvailableInDemoError, NotFoundError, OrderRejectedError, Trading212 } from "../../src/index";

const apiKey = process.env.T212_DEMO_API_KEY;
const apiSecret = process.env.T212_DEMO_API_SECRET;
const run = apiKey && apiSecret ? describe : describe.skip;

run("demo contract", () => {
	let client: Trading212;
	beforeAll(() => {
		client = new Trading212({ environment: "demo", apiKey: apiKey ?? "", apiSecret: apiSecret ?? "" });
	});

	it("signs in", async () => {
		const me = await client.verify();
		expect(me.environment).toBe("demo");
		expect(typeof me.accountId).toBe("number");
	});

	it("reads positions, orders and the portfolio", async () => {
		expect(Array.isArray(await client.positions.list())).toBe(true);
		expect(Array.isArray(await client.orders.list())).toBe(true);
		const snapshot = await client.portfolio.snapshot();
		expect(snapshot.currency).toMatch(/^[A-Z]{3}$/);
	});

	it("finds Apple in the instrument list and knows its market", async () => {
		const apple = await client.instruments.resolve("AAPL", { currency: "USD" });
		expect(apple.ticker).toBe("AAPL_US_EQ");
		const status = await client.exchanges.status(apple);
		expect(["regular", "preMarket", "afterHours", "overnight", "closed", "unknown"]).toContain(status.session);
	});

	it("pages through history", async () => {
		const page = await client.history.orders.list({ limit: 2 });
		expect(Array.isArray(page.items)).toBe(true);
		await client.history.dividends.list({ limit: 1 });
		await client.history.transactions.list({ limit: 1 });
	});

	it("answers a missing order with NotFoundError", async () => {
		await expect(client.orders.get(1)).rejects.toBeInstanceOf(NotFoundError);
	});

	it("refuses CSV exports on demo with NotAvailableInDemoError", async () => {
		await expect(client.reports.list()).rejects.toBeInstanceOf(NotAvailableInDemoError);
	});

	it("places a limit order far from the market and cancels it", async () => {
		try {
			const order = await client.orders.buy({
				type: "limit",
				ticker: "AAPL_US_EQ",
				quantity: 0.1,
				limitPrice: 1,
				timeValidity: "DAY",
			});
			expect(order.id).toBeTypeOf("number");
			await client.orders.cancel(order.id ?? 0);
		} catch (error) {
			// Outside trading hours the demo may refuse instead; that is still the contract.
			expect(error).toBeInstanceOf(OrderRejectedError);
		}
	});
});
