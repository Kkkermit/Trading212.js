import { describe, expect, it } from "vitest";

import * as csv from "../src/csv";
import * as root from "../src/index";
import * as testing from "../src/testing";

/** The public surface. A change here is a change for every user: add a changeset and say so in the guide. */
describe("public exports", () => {
	it("from the package root", () => {
		expect(Object.keys(root).sort()).toEqual([
			"AuthenticationError",
			"BASE_URLS",
			"ConfigurationError",
			"ENDPOINTS",
			"FINAL_ORDER_STATUSES",
			"HttpError",
			"InstrumentNotFoundError",
			"MemoryCache",
			"MissingScopeError",
			"NetworkError",
			"NotAvailableInDemoError",
			"NotFoundError",
			"OrderOutcomeUnknownError",
			"OrderRejectedError",
			"PermissionError",
			"QUANTITY_DECIMALS",
			"RateLimitError",
			"SPEC_VERSION",
			"ServerError",
			"TIME_VALIDITIES",
			"TimeoutError",
			"Trading212",
			"Trading212Error",
			"TradingDisabledError",
			"UnexpectedResponseError",
			"VERSION",
			"ValidationError",
			"buildPortfolioSnapshot",
			"consoleLogger",
			"decimalPlaces",
			"fieldsFirst",
			"isTrading212Error",
			"isValidQuantity",
			"parseErrorBody",
			"sessionAt",
			"silentLogger",
			"truncateQuantity",
		]);
	});

	it("from the testing and csv entry points", () => {
		expect(Object.keys(testing).sort()).toEqual([
			"DEFAULT_INSTRUMENTS",
			"FAKE_API_KEY",
			"FAKE_API_SECRET",
			"FakeTrading212Server",
			"createFakeTrading212",
			"networkError",
			"scriptedFetch",
			"weekOfSessions",
		]);
		expect(Object.keys(csv).sort()).toEqual(["csvNumber", "parseCsv", "parseCsvRows"]);
	});

	it("names every endpoint in the spec", () => {
		expect(Object.keys(root.ENDPOINTS)).toHaveLength(22);
		expect(root.ENDPOINTS.listDividends.rateLimit).toEqual({ requests: 20, periodMs: 60_000 });
		expect(Object.values(root.ENDPOINTS).filter((endpoint) => endpoint.kind === "trade")).toHaveLength(9);
	});
});

describe("ENDPOINTS", () => {
	/** A mutable table would let any code make trades retryable or skip the live switch. */
	it("cannot be changed at run time", () => {
		expect(() => {
			(root.ENDPOINTS.placeMarketOrder as { kind: string }).kind = "read";
		}).toThrow(TypeError);
		expect(() => {
			(root.ENDPOINTS.placeMarketOrder.rateLimit as { requests: number }).requests = 1000;
		}).toThrow(TypeError);
		expect(() => {
			(root.ENDPOINTS as Record<string, unknown>).extra = {};
		}).toThrow(TypeError);
	});
});
