import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/errors/errors";
import { createFakeTrading212 } from "../../src/testing";

import { scripted } from "../helpers";

describe("pies", () => {
	it("creates, reads, updates, duplicates and deletes pies", async () => {
		const { client } = createFakeTrading212();
		const created = await client.pies.create({ name: "Tech", instrumentShares: { AAPL_US_EQ: 0.5, MSFT_US_EQ: 0.5 } });
		const id = created.settings?.id ?? 0;
		expect(created.instruments?.map((instrument) => instrument.ticker)).toEqual(["AAPL_US_EQ", "MSFT_US_EQ"]);
		expect((await client.pies.update(id, { name: "Big tech" })).settings?.name).toBe("Big tech");
		const copy = await client.pies.duplicate(id, { name: "Copy" });
		expect(copy.settings?.name).toBe("Copy");
		expect(await client.pies.list()).toHaveLength(2);
		expect((await client.pies.get(id)).settings?.name).toBe("Big tech");
		await client.pies.delete(id);
		await expect(client.pies.get(id)).rejects.toMatchObject({ hint: expect.stringContaining("pies.list()") });
		await expect(client.pies.update(id, {})).rejects.toThrow("404");
		await expect(client.pies.duplicate(id)).rejects.toThrow("404");
		await expect(client.pies.delete(id)).rejects.toThrow("404");
		await expect(client.pies.get(0)).rejects.toBeInstanceOf(ValidationError);
		const empty = scripted([{ body: null }]);
		expect(await empty.client.pies.list()).toEqual([]);
	});
});
