import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OrderRejectedError, type Trading212 } from "@kkkermit/trading212.js";
import { createFakeTrading212 } from "@kkkermit/trading212.js/testing";

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
		assert.equal(await takeProfit(client, "AAPL_US_EQ"), false);

		server.setPrice("AAPL_US_EQ", 111);
		assert.equal(await takeProfit(client, "AAPL_US_EQ"), true);
		assert.equal(server.position("AAPL_US_EQ"), undefined);
	});

	it("passes on a refusal from Trading 212", async () => {
		const { client, server } = createFakeTrading212({
			state: { positions: [{ ticker: "AAPL_US_EQ", quantity: 1, averagePrice: 100 }] },
		});
		server.setPrice("AAPL_US_EQ", 200);
		server.marketOpen = false;
		await assert.rejects(takeProfit(client, "AAPL_US_EQ"), OrderRejectedError);
	});
});
