import { describe, expect, it } from "vitest";

import { createFakeTrading212 } from "../../src/testing";

import { scripted } from "../helpers";

describe("positions", () => {
	it("lists positions and finds one by ticker", async () => {
		const { client } = createFakeTrading212({
			state: { positions: [{ ticker: "AAPL_US_EQ", quantity: 2, averagePrice: 200 }] },
		});
		const [position] = await client.positions.list();
		expect(position?.walletImpact).toMatchObject({ currentValue: 460, totalCost: 400, unrealizedProfitLoss: 60 });
		expect((await client.positions.get("AAPL_US_EQ"))?.quantity).toBe(2);
		expect(await client.positions.get("TSLA_US_EQ")).toBeUndefined();
	});

	/** If the filter were ignored, the first holding must not be passed off as the one asked for. */
	it("never returns a different holding when the filter is ignored", async () => {
		const { client } = scripted([
			{ body: [{ instrument: { ticker: "MSFT_US_EQ" }, quantity: 9 }] },
			{ body: { not: "a list" } },
		]);
		expect(await client.positions.get("AAPL_US_EQ")).toBeUndefined();
		expect(await client.positions.list()).toEqual([]);
	});
});
