import { describe, expect, it, vi } from "vitest";

import { MemoryCache } from "../../src/cache";
import { InstrumentNotFoundError, ValidationError } from "../../src/errors/errors";
import { createFakeTrading212, DEFAULT_INSTRUMENTS } from "../../src/testing";

import { scripted } from "../helpers";

describe("instruments", () => {
	it("downloads the list once and shares it between concurrent callers", async () => {
		const { client, server } = createFakeTrading212();
		const [first, second] = await Promise.all([client.instruments.list(), client.instruments.list()]);
		expect(first).toBe(second);
		await client.instruments.search("apple");
		expect(server.requests.filter((request) => request.path.endsWith("/instruments"))).toHaveLength(1);
		await client.instruments.list({ refresh: true });
		expect(server.requests.filter((request) => request.path.endsWith("/instruments"))).toHaveLength(2);
	});

	it("keeps the list in a cache store you provide", async () => {
		const cache = new MemoryCache();
		const set = vi.spyOn(cache, "set");
		const { client } = createFakeTrading212({ client: { cache, metadataTtlMs: 1000 } });
		await client.instruments.list();
		expect(set).toHaveBeenCalledWith(expect.stringMatching(/:instruments$/), expect.any(Array), 1000);
	});

	it("does not cache a failed download", async () => {
		const { client, server } = createFakeTrading212();
		server.failNext("listInstruments", { status: 400 });
		await expect(client.instruments.list()).rejects.toBeInstanceOf(ValidationError);
		await expect(client.instruments.list()).resolves.toHaveLength(DEFAULT_INSTRUMENTS.length);
	});

	it("ranks search results by how well they match", async () => {
		const { client } = createFakeTrading212();
		expect((await client.instruments.search("AAPL_US_EQ")).map((instrument) => instrument.ticker)[0]).toBe(
			"AAPL_US_EQ",
		);
		expect((await client.instruments.search("US0378331005"))[0]?.ticker).toBe("AAPL_US_EQ");
		expect((await client.instruments.search("vanguard"))[0]?.ticker).toBe("VUSAl_EQ");
		expect((await client.instruments.search("S&P 500"))[0]?.ticker).toBe("VUSAl_EQ");
		expect((await client.instruments.search("ms"))[0]?.ticker).toBe("MSFT_US_EQ");
		expect((await client.instruments.search("Tesla"))[0]?.ticker).toBe("TSLA_US_EQ");
		expect((await client.instruments.search("soft"))[0]?.ticker).toBe("MSFT_US_EQ");
		expect(await client.instruments.search("zzz")).toEqual([]);
		expect(await client.instruments.search("a", { type: "ETF", limit: 5 })).toHaveLength(1);
		expect(await client.instruments.search("a", { currency: "usd" })).toHaveLength(2);
		await expect(client.instruments.search("  ")).rejects.toBeInstanceOf(ValidationError);
	});

	it("finds an exact ticker", async () => {
		const { client } = createFakeTrading212();
		expect((await client.instruments.find("TSLA_US_EQ"))?.name).toBe("Tesla");
		expect(await client.instruments.find("TSLA")).toBeUndefined();
	});

	it("resolves what a person would type to exactly one instrument", async () => {
		const { client } = createFakeTrading212();
		expect((await client.instruments.resolve("AAPL")).ticker).toBe("AAPL_US_EQ");
		expect((await client.instruments.resolve("vusa")).ticker).toBe("VUSAl_EQ");
		expect((await client.instruments.resolve("US88160R1014")).ticker).toBe("TSLA_US_EQ");
		expect((await client.instruments.resolve("Apple")).ticker).toBe("AAPL_US_EQ");
	});

	it("explains, with suggestions, when it cannot pick one", async () => {
		const twins = [
			{ ticker: "AAPL_US_EQ", shortName: "AAPL", name: "Apple", currencyCode: "USD" },
			{ ticker: "APCd_EQ", shortName: "AAPL", name: "Apple", currencyCode: "EUR" },
		];
		const { client } = createFakeTrading212({ state: { instruments: twins } });
		const ambiguous = (await client.instruments
			.resolve("AAPL")
			.catch((caught: unknown) => caught)) as InstrumentNotFoundError;
		expect(ambiguous).toBeInstanceOf(InstrumentNotFoundError);
		expect(ambiguous.message).toContain("2 instruments match equally well");
		expect(ambiguous.suggestions.map((suggestion) => suggestion.ticker)).toEqual(["AAPL_US_EQ", "APCd_EQ"]);
		expect(ambiguous.hint).toContain("{ currency }");
		expect((await client.instruments.resolve("AAPL", { currency: "EUR" })).ticker).toBe("APCd_EQ");
		await expect(client.instruments.resolve("App")).rejects.toThrow("2 instruments match equally well");
		const single = createFakeTrading212();
		await expect(single.client.instruments.resolve("Micro")).rejects.toThrow("no instrument matched exactly");
		await expect(client.instruments.resolve("nothing")).rejects.toThrow("nothing matched");
		await expect(client.instruments.resolve("APPLE", { type: "ETF" })).rejects.toMatchObject({
			hint: expect.stringContaining("Check the spelling"),
		});
	});

	it("survives a list missing fields", async () => {
		const { client } = scripted([{ body: [{}, { ticker: "X_EQ" }] }, { body: { not: "a list" } }]);
		expect(await client.instruments.search("x")).toHaveLength(1);
		expect(await client.instruments.list({ refresh: true })).toEqual([]);
	});
});
