import { describe, expect, it } from "vitest";

import { buildPortfolioSnapshot } from "../../src/resources/portfolio";
import { createFakeTrading212 } from "../../src/testing";

describe("portfolio", () => {
	it("combines the summary and positions into one picture", async () => {
		const { client } = createFakeTrading212({
			state: {
				cash: 500,
				positions: [
					{ ticker: "AAPL_US_EQ", quantity: 1, averagePrice: 200 },
					{ ticker: "MSFT_US_EQ", quantity: 1, averagePrice: 420 },
				],
			},
		});
		const snapshot = await client.portfolio.snapshot();
		expect(snapshot).toMatchObject({
			currency: "GBP",
			cash: 500,
			invested: 650,
			totalValue: 1150,
			unrealisedProfitLoss: 30,
		});
		expect(snapshot.holdings.map((holding) => holding.ticker)).toEqual(["MSFT_US_EQ", "AAPL_US_EQ"]);
		expect(snapshot.holdings[1]).toMatchObject({ value: 230, cost: 200, profitLoss: 30, profitLossRatio: 0.15 });
		expect(snapshot.holdings.reduce((total, holding) => total + holding.weight, 0)).toBeCloseTo(1);
	});

	it("copes with missing numbers", () => {
		const snapshot = buildPortfolioSnapshot({}, [{}], new Date(0));
		expect(snapshot).toMatchObject({ currency: undefined, totalValue: 0, invested: 0, takenAt: new Date(0) });
		expect(snapshot.holdings[0]).toMatchObject({ ticker: "", weight: 0, profitLossRatio: undefined });
	});
});
