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
});
