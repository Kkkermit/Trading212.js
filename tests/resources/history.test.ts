import { describe, expect, it } from "vitest";

import { createFakeTrading212 } from "../../src/testing";
import { scripted } from "../helpers";

describe("history", () => {
	it("pages through dividends and transactions", async () => {
		const dividends = Array.from({ length: 3 }, (_, index) => ({
			ticker: index === 1 ? "MSFT_US_EQ" : "AAPL_US_EQ",
			amount: index,
		}));
		const transactions = Array.from({ length: 5 }, (_, index) => ({ type: "DEPOSIT", amount: index }));
		const { client } = createFakeTrading212({ state: { dividends, transactions } });
		expect(
			(await Array.fromAsync(client.history.dividends.all({ ticker: "AAPL_US_EQ", pageSize: 1 }))).map(
				(item) => item.amount,
			),
		).toEqual([0, 2]);
		const first = await client.history.transactions.list({ limit: 2 });
		expect(first.nextCursor).toContain("time=");
		expect((await Array.fromAsync(client.history.transactions.all({ pageSize: 2 }))).length).toBe(5);
		await expect(Array.fromAsync(client.history.transactions.all({ pageSize: 99 }))).rejects.toThrow("pageSize");
	});

	it("starts transactions from a time, as the spec allows", async () => {
		const { client, requests } = scripted([{ body: { items: [], nextPagePath: null } }]);
		await client.history.transactions.list({ time: new Date("2026-01-01T00:00:00Z"), limit: 10 });
		expect(requests[0]?.query).toEqual({ time: "2026-01-01T00:00:00.000Z", limit: "10" });
	});

	it("adds up dividends in a date range, in total and per ticker, reading back only as far as it needs", async () => {
		const paid = (ticker: string, amount: number, paidOn: string) => ({ ticker, amount, paidOn, currency: "GBP" });
		const dividends = [
			paid("AAPL_US_EQ", 0.1, "2026-10-01T00:00:00Z"),
			paid("MSFT_US_EQ", 0.75, "2026-09-01T00:00:00Z"),
			paid("AAPL_US_EQ", 0.2, "2026-05-01T00:00:00Z"),
			paid("AAPL_US_EQ", 9, "2026-03-01T00:00:00Z"),
			...Array.from({ length: 60 }, () => paid("VUSAl_EQ", 1, "2025-01-01T00:00:00Z")),
		];
		const { client, server } = createFakeTrading212({ state: { dividends } });
		expect(
			await client.history.dividends.total({ since: "2026-04-06", until: new Date("2026-10-01T00:00:00Z") }),
		).toEqual({
			total: 0.95,
			count: 2,
			currency: "GBP",
			byTicker: { MSFT_US_EQ: 0.75, AAPL_US_EQ: 0.2 },
		});
		// Floating-point noise from 0.1 + 0.2 is tidied away.
		expect((await client.history.dividends.total({ since: "2026-04-06", ticker: "AAPL_US_EQ" })).total).toBe(0.3);
		expect(server.requests.filter((request) => request.path.endsWith("/dividends"))).toHaveLength(2);
		expect(await client.history.dividends.total()).toMatchObject({ count: 64, total: 70.05 });
		await expect(client.history.dividends.total({ since: "last year" })).rejects.toThrow("since is not a valid date");
	});
});
