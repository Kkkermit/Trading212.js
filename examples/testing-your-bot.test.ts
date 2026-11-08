// How to test your own code with the fake Trading 212: no network, no key, real client behaviour.
import { OrderRejectedError, type Trading212 } from "@kkkermit/trading212.js";
import { createFakeTrading212 } from "@kkkermit/trading212.js/testing";
import { describe, expect, it } from "vitest";

// The code under test: sells a holding once it is up 10%.
async function takeProfit(t212: Trading212, ticker: string): Promise<boolean> {
	const position = await t212.positions.get(ticker);
	if (!position?.averagePricePaid || !position.currentPrice) return false;
	if (position.currentPrice < position.averagePricePaid * 1.1) return false;
	await t212.orders.sellAll(ticker);
	return true;
}

describe("takeProfit", () => {
	it("sells once the price is up 10%", async () => {
		const { client, server } = createFakeTrading212({
			state: { positions: [{ ticker: "AAPL_US_EQ", quantity: 3, averagePrice: 100 }] },
		});
		server.setPrice("AAPL_US_EQ", 105);
		expect(await takeProfit(client, "AAPL_US_EQ")).toBe(false);
		server.setPrice("AAPL_US_EQ", 111);
		expect(await takeProfit(client, "AAPL_US_EQ")).toBe(true);
		expect(server.position("AAPL_US_EQ")).toBeUndefined();
	});

	it("surfaces a closed market", async () => {
		const { client, server } = createFakeTrading212({
			state: { positions: [{ ticker: "AAPL_US_EQ", quantity: 1, averagePrice: 100 }] },
		});
		server.setPrice("AAPL_US_EQ", 200);
		server.marketOpen = false;
		await expect(takeProfit(client, "AAPL_US_EQ")).rejects.toBeInstanceOf(OrderRejectedError);
	});
});
