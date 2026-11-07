import { describe, expect, it, vi } from "vitest";

import { MemoryCache } from "../../src/cache";
import {
	InstrumentNotFoundError,
	NotAvailableInDemoError,
	TimeoutError,
	UnexpectedResponseError,
	ValidationError,
} from "../../src/errors/errors";
import { sessionAt } from "../../src/resources/exchanges";
import { buildPortfolioSnapshot } from "../../src/resources/portfolio";
import { createFakeTrading212, DEFAULT_INSTRUMENTS } from "../../src/testing";
import { scripted } from "../helpers";

describe("account and verify", () => {
	it("verifies the key and names the account", async () => {
		const { client } = createFakeTrading212({ state: { accountId: 42, currency: "EUR" } });
		await expect(client.verify()).resolves.toEqual({
			environment: "demo",
			accountId: 42,
			currency: "EUR",
			trading: "enabled",
		});
	});

	it("copes with a summary that leaves fields out", async () => {
		const { client } = scripted([{ body: {} }]);
		await expect(client.verify()).resolves.toEqual({
			environment: "demo",
			accountId: undefined,
			currency: undefined,
			trading: "enabled",
		});
	});
});

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

describe("exchanges", () => {
	const events = [
		{ type: "PRE_MARKET_OPEN", date: "2026-11-09T09:00:00Z" },
		{ type: "OPEN", date: "2026-11-09T14:30:00Z" },
		{ type: "CLOSE", date: "2026-11-09T21:00:00Z" },
		{ type: "AFTER_HOURS_CLOSE", date: "2026-11-10T01:00:00Z" },
		{ type: "AFTER_HOURS_OPEN", date: "2026-11-09T21:00:01Z" },
		{ type: "OPEN", date: "2026-11-10T14:30:00Z" },
		{ type: "WHATEVER", date: "2026-11-11T00:00:00Z" },
		{ type: "OPEN" },
		{ date: "2026-11-12T00:00:00Z" },
		{ type: "OPEN", date: "not a date" },
	];

	it("works out the session from the schedule", () => {
		expect(sessionAt(events, new Date("2026-11-09T08:00:00Z"))).toMatchObject({
			session: "unknown",
			next: { event: "PRE_MARKET_OPEN" },
		});
		expect(sessionAt(events, new Date("2026-11-09T10:00:00Z")).session).toBe("preMarket");
		expect(sessionAt(events, new Date("2026-11-09T15:00:00Z"))).toMatchObject({
			session: "regular",
			since: new Date("2026-11-09T14:30:00Z"),
			next: { event: "CLOSE", at: new Date("2026-11-09T21:00:00Z") },
			nextOpen: new Date("2026-11-10T14:30:00Z"),
		});
		expect(sessionAt(events, new Date("2026-11-09T22:00:00Z")).session).toBe("afterHours");
		expect(sessionAt(events, new Date("2026-11-10T02:00:00Z")).session).toBe("closed");
		expect(sessionAt(events, new Date("2026-11-11T02:00:00Z"))).toMatchObject({
			session: "unknown",
			nextOpen: undefined,
		});
	});

	it("tells you whether an instrument's market is open", async () => {
		const exchanges = [{ id: 1, name: "NASDAQ", workingSchedules: [{ id: 1, timeEvents: events }] }];
		const { client } = createFakeTrading212({ state: { exchanges } });
		expect(await client.exchanges.status("AAPL_US_EQ", new Date("2026-11-09T15:00:00Z"))).toMatchObject({
			ticker: "AAPL_US_EQ",
			exchange: "NASDAQ",
			open: true,
			extendedHours: false,
		});
		const [apple] = await client.instruments.search("AAPL");
		expect(await client.exchanges.status(apple ?? {}, new Date("2026-11-09T22:00:00Z"))).toMatchObject({
			open: false,
			extendedHours: true,
		});
		expect(await client.exchanges.status("VUSAl_EQ")).toMatchObject({ session: "unknown", exchange: undefined });
		await expect(client.exchanges.status("NOPE")).rejects.toBeInstanceOf(InstrumentNotFoundError);
		expect(await client.exchanges.status({ workingScheduleId: 1 })).toMatchObject({ ticker: "" });
	});

	it("caches the exchange list", async () => {
		const { client, server } = createFakeTrading212();
		await client.exchanges.list();
		await client.exchanges.list();
		expect(server.requests.filter((request) => request.path.endsWith("/exchanges"))).toHaveLength(1);
		const empty = scripted([{ body: null }]);
		expect(await empty.client.exchanges.list()).toEqual([]);
	});
});

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
});

describe("reports", () => {
	it("requests, waits for and downloads a report without sending credentials", async () => {
		const { client, server } = createFakeTrading212({ environment: "live" });
		await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 });
		const statuses: unknown[] = [];
		const { report, csv } = await client.reports.export(
			{ from: new Date("2026-01-01"), to: "2026-12-31", include: { interest: false } },
			{ intervalMs: 1, onStatus: (current) => statuses.push(current.status) },
		);
		expect(statuses).toEqual(["Queued", "Finished"]);
		expect(report.downloadLink).toMatch(/^https:\/\/reports\.fake-trading212\.invalid\//);
		expect(csv.split("\n")[1]).toContain("AAPL_US_EQ");
		expect(
			server.requests.find((request) => request.path.endsWith("/exports") && request.method === "POST")?.body,
		).toEqual({
			timeFrom: "2026-01-01T00:00:00.000Z",
			timeTo: "2026-12-31T00:00:00.000Z",
			dataIncluded: { includeDividends: true, includeInterest: false, includeOrders: true, includeTransactions: true },
		});
	});

	it("refuses bad dates before asking", async () => {
		const { client, server } = createFakeTrading212({ environment: "live" });
		await expect(client.reports.request({ from: "garbage", to: "2026-01-01" })).rejects.toThrow(
			"from is not a valid date",
		);
		await expect(client.reports.request({ from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow(
			"from must be before to",
		);
		expect(server.requests).toHaveLength(0);
	});

	it("explains that exports are live only", async () => {
		const { client } = createFakeTrading212();
		const error = (await client.reports.list().catch((caught: unknown) => caught)) as NotAvailableInDemoError;
		expect(error).toBeInstanceOf(NotAvailableInDemoError);
		expect(error.hint).toContain("live only");
	});

	it("lets the fake offer exports on demo when asked", async () => {
		const { client, server } = createFakeTrading212();
		server.exportsOnDemo = true;
		expect(await client.reports.request({ from: "2026-01-01", to: "2026-02-01" })).toBeGreaterThan(0);
	});

	it("fails clearly when a report fails, never finishes, or has no ID", async () => {
		const failed = scripted([{ body: [{ reportId: 1, status: "Failed" }] }]);
		await expect(failed.client.reports.waitFor(1)).rejects.toThrow("Report 1 failed.");
		const cancelled = scripted([{ body: [{ reportId: 1, status: "Canceled" }] }]);
		await expect(cancelled.client.reports.waitFor(1)).rejects.toThrow("was cancelled");
		const running = { body: [{ reportId: 1, status: "Running" }] };
		const slow = scripted([{ body: [] }, running, running, running, running, running]);
		await expect(slow.client.reports.waitFor(1, { timeoutMs: 15, intervalMs: 10 })).rejects.toBeInstanceOf(
			TimeoutError,
		);
		const noId = scripted([{ body: {} }]);
		await expect(noId.client.reports.request({ from: "2026-01-01", to: "2026-02-01" })).rejects.toBeInstanceOf(
			UnexpectedResponseError,
		);
		const empty = scripted([{ body: null }]);
		expect(await empty.client.reports.list()).toEqual([]);
	});

	it("checks the download link and reports download failures", async () => {
		const { client } = scripted([]);
		await expect(client.reports.download({})).rejects.toThrow("no download link");
		await expect(client.reports.download("not a url")).rejects.toThrow("not a valid URL");
		await expect(client.reports.download("http://plain.example/x.csv")).rejects.toThrow("not https");
		const gone = scripted([{ status: 403 }]);
		await expect(gone.client.reports.download("https://s3.example/x.csv?sig=secret")).rejects.toThrow(
			"https://s3.example/x.csv?[REDACTED] failed with 403",
		);
		const offline = scripted([new TypeError("fetch failed")]);
		await expect(offline.client.reports.download("https://s3.example/x.csv")).rejects.toThrow("Could not download");
		const controller = new AbortController();
		controller.abort(new Error("stopped"));
		const aborted = scripted([new TypeError("aborted")]);
		await expect(
			aborted.client.reports.download("https://s3.example/x.csv", { signal: controller.signal }),
		).rejects.toThrow("stopped");
		const fine = scripted([{ body: "a,b\n1,2\n" }]);
		await expect(fine.client.reports.download("https://s3.example/x.csv", { timeoutMs: 1000 })).resolves.toBe(
			"a,b\n1,2\n",
		);
	});
});

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
