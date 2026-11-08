import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	AuthenticationError,
	HttpError,
	MissingScopeError,
	NotAvailableInDemoError,
	NotFoundError,
	OrderOutcomeUnknownError,
	OrderRejectedError,
	PermissionError,
	RateLimitError,
	ServerError,
	TimeoutError,
	ValidationError,
} from "../../src/errors/errors";
import { errorFromResponse, parseErrorBody, type ResponseContext } from "../../src/errors/fromResponse";
import { ORDER_REJECTION_HINTS } from "../../src/errors/hints";
import { parseRateLimitHeaders } from "../../src/http/rateLimitHeaders";
import type { Trading212 } from "../../src/index";
import { scripted } from "../helpers";

const context = (overrides: Partial<ResponseContext>): ResponseContext => ({
	status: 400,
	statusText: "",
	text: "",
	request: { method: "GET", path: "/api/v0/equity/positions", endpoint: "listPositions" },
	kind: "read",
	environment: "demo",
	rateLimit: undefined,
	now: 1_000_000,
	...overrides,
});

describe("parseErrorBody", () => {
	it("reads problem details", () => {
		expect(
			parseErrorBody(
				'{"type":"/api-errors/not-available-in-demo-account","title":"Nope","status":403,"detail":"Not in demo","traceId":"abc123"}',
			),
		).toMatchObject({ apiCode: "not-available-in-demo-account", message: "Not in demo", traceId: "abc123" });
	});

	it("reads the code and errorMessage shape a 429 arrives in", () => {
		expect(
			parseErrorBody(
				'{"code":"BusinessException","context":{"type":"TooManyRequests"},"errorMessage":"too many requests"}',
			),
		).toMatchObject({ apiCode: "TooManyRequests", message: "too many requests" });
	});

	it("prints a Java Optional as its value", () => {
		expect(parseErrorBody('{"detail":"Max quantity for single order is Optional[32880]"}').message).toBe(
			"Max quantity for single order is 32880",
		);
	});

	it("reads the legacy code and clarification shape", () => {
		expect(parseErrorBody('{"code":"SellingEquityNotOwned","clarification":"You do not own it"}')).toMatchObject({
			apiCode: "SellingEquityNotOwned",
			message: "You do not own it",
		});
	});

	it("reads code and message", () => {
		expect(parseErrorBody('{"code":"AuthenticationFailed","message":"Bad API key"}')).toMatchObject({
			apiCode: "AuthenticationFailed",
			message: "Bad API key",
		});
	});

	it("reads plain text, JSON strings, arrays and nothing", () => {
		expect(parseErrorBody("Service down")).toEqual({ message: "Service down", body: "Service down" });
		expect(parseErrorBody('"quoted"')).toEqual({ message: "quoted", body: "quoted" });
		expect(parseErrorBody("[1,2]")).toEqual({ body: [1, 2] });
		expect(parseErrorBody("   ")).toEqual({});
		expect(parseErrorBody('{"type":"about:blank","title":"Teapot"}')).toEqual({
			message: "Teapot",
			body: { type: "about:blank", title: "Teapot" },
		});
	});

	it("caps a long message", () => {
		expect(parseErrorBody("x".repeat(2000)).message).toHaveLength(500);
	});
});

describe("errorFromResponse", () => {
	it("turns a 401 into an AuthenticationError naming the environment", () => {
		const error = errorFromResponse(context({ status: 401, statusText: "Unauthorized", environment: "live" }));
		expect(error).toBeInstanceOf(AuthenticationError);
		expect((error as AuthenticationError).environment).toBe("live");
		expect(error.hint).toContain("real-money (live)");
		expect(error.message).toBe(
			"GET /api/v0/equity/positions was refused: Trading 212 did not accept the API key and secret.",
		);
		expect(errorFromResponse(context({ status: 401 })).hint).toContain("practice (demo)");
	});

	it("reads the missing scope out of a 403", () => {
		const error = errorFromResponse(context({ status: 403, text: "Scope( orders:execute ) missing for API key" }));
		expect(error).toBeInstanceOf(MissingScopeError);
		expect((error as MissingScopeError).scope).toBe("orders:execute");
		expect(error.hint).toContain('"orders:execute"');
	});

	it("tells a demo-only refusal from other 403s", () => {
		const demo = errorFromResponse(
			context({ status: 403, text: '{"type":"/api-errors/not-available-in-demo-account"}' }),
		);
		expect(demo).toBeInstanceOf(NotAvailableInDemoError);
		const other = errorFromResponse(context({ status: 403, text: "Forbidden" }));
		expect(other).toBeInstanceOf(PermissionError);
		expect(other.hint).toContain("IP addresses");
	});

	it("names known order rejections, in either spelling of the code", () => {
		for (const [text, reason] of [
			['{"type":"/api-errors/min-quantity-exceeded","detail":"must trade at least 1.5"}', "min-quantity-exceeded"],
			['{"type":"/api-errors/max-quantity-exceeded"}', "max-quantity-exceeded"],
			['{"code":"InsufficientFreeForStocksBuy"}', "insufficient-free-for-stocks-buy"],
			['{"code":"SellingEquityNotOwned"}', "selling-equity-not-owned"],
			['{"code":"MarketClosed","clarification":"closed"}', "market-closed"],
			['{"type":"/api-errors/quantity-precision-mismatch"}', "quantity-precision-mismatch"],
		] as const) {
			const error = errorFromResponse(context({ status: 400, text, kind: "trade" }));
			expect(error, text).toBeInstanceOf(OrderRejectedError);
			expect((error as OrderRejectedError).reason).toBe(reason);
			expect(error.hint).toBeTruthy();
		}
	});

	it("keeps an unknown rejection code on a trade, and treats other 400s as validation", () => {
		const trade = errorFromResponse(context({ status: 400, text: '{"code":"SomethingNew"}', kind: "trade" }));
		expect(trade).toBeInstanceOf(OrderRejectedError);
		expect((trade as OrderRejectedError).reason).toBe("SomethingNew");
		const read = errorFromResponse(context({ status: 400, text: '{"code":"BadFilter"}' }));
		expect(read).toBeInstanceOf(ValidationError);
		expect(read).not.toBeInstanceOf(OrderRejectedError);
		expect(read.apiCode).toBe("BadFilter");
	});

	/** A malformed order is the caller's mistake, not Trading 212 turning the order down. */
	it("treats an invalid request on a trade as validation, not a rejection", () => {
		const error = errorFromResponse(
			context({
				status: 400,
				text: '{"type":"/api-errors/invalid-request","detail":"Invalid payload"}',
				kind: "trade",
			}),
		);
		expect(error).toBeInstanceOf(ValidationError);
		expect(error).not.toBeInstanceOf(OrderRejectedError);
		expect(error.apiCode).toBe("invalid-request");
	});

	it("gives 404s a hint for the endpoint", () => {
		const order = errorFromResponse(
			context({ status: 404, request: { method: "GET", path: "/x", endpoint: "getOrder" } }),
		);
		expect(order).toBeInstanceOf(NotFoundError);
		expect(order.hint).toContain("history.orders.list()");
		expect(errorFromResponse(context({ status: 404, request: { method: "GET", path: "/x" } })).hint).toContain(
			"nothing",
		);
	});

	it("works out when to retry after a 429", () => {
		const error = errorFromResponse(context({ status: 429, rateLimit: { resetAt: 1_004_000 } })) as RateLimitError;
		expect(error).toBeInstanceOf(RateLimitError);
		expect(error.retryAfterMs).toBe(4000);
		expect(error.resetAt?.getTime()).toBe(1_004_000);
		const unknown = errorFromResponse(context({ status: 429 })) as RateLimitError;
		expect(unknown.retryAfterMs).toBeUndefined();
		expect(unknown.hint).toContain("a moment");
	});

	it("separates timeouts, server errors and anything else", () => {
		expect(errorFromResponse(context({ status: 408 }))).toBeInstanceOf(TimeoutError);
		expect(errorFromResponse(context({ status: 503 }))).toBeInstanceOf(ServerError);
		expect(errorFromResponse(context({ status: 409 }))).toBeInstanceOf(HttpError);
		expect(errorFromResponse(context({ status: 408, kind: "write" })).hint).toContain("never retried");
		expect(errorFromResponse(context({ status: 500, kind: "write" })).hint).toContain("never retried");
	});

	/** A trade that times out or hits a server error may have executed; saying "failed" would invite a duplicate. */
	it("reports a trade's 408 or 5xx as an unknown outcome", () => {
		for (const status of [408, 500, 502]) {
			const error = errorFromResponse(context({ status, kind: "trade", sent: { ticker: "AAPL_US_EQ" } }));
			expect(error).toBeInstanceOf(OrderOutcomeUnknownError);
			expect((error as OrderOutcomeUnknownError).sent).toEqual({ ticker: "AAPL_US_EQ" });
		}
	});
});

describe("error messages", () => {
	const trade = (text: string, sent?: unknown) =>
		errorFromResponse(context({ status: 400, text, kind: "trade", sent })).message.replace(
			"GET /api/v0/equity/positions ",
			"",
		);

	it("say what a refusal broke even when the order or the number is missing", () => {
		expect(trade('{"code":"SellingEquityNotOwned"}')).toBe(
			"was refused: it sells this instrument, more than the account owns.",
		);
		expect(trade('{"type":"/api-errors/min-quantity-exceeded"}')).toBe(
			"was refused: the quantity is below the smallest Trading 212 accepts for this order.",
		);
		expect(
			trade('{"type":"/api-errors/insufficient-free-for-stocks-buy"}', { ticker: "AAPL_US_EQ", quantity: 2 }),
		).toBe("was refused: there is not enough free cash to buy 2 AAPL_US_EQ.");
		expect(trade('{"type":"/api-errors/market-closed"}', { ticker: "AAPL_US_EQ", quantity: 1, stopPrice: 9 })).toBe(
			"was refused: the market for AAPL_US_EQ is closed.",
		);
		expect(trade('{"type":"/api-errors/quantity-precision-mismatch"}', "not an order")).toBe(
			"was refused: the quantity has more decimal places than the 4 Trading 212 allows.",
		);
		expect(trade('{"code":"SomethingNew","message":"Nope"}')).toBe("was refused (SomethingNew): Nope.");
	});

	/** "Failed" would invite a resend of an order that may have filled. */
	it("never call a trade that may have run a failure", () => {
		const error = errorFromResponse(context({ status: 502, statusText: "Bad Gateway", kind: "trade" }));
		expect(error.message).toBe(
			"GET /api/v0/equity/positions may or may not have gone through: Trading 212 answered 502 Bad Gateway.",
		);
	});

	it("name the permission, the refusal or the status for everything else", () => {
		const message = (overrides: Partial<ResponseContext>) =>
			errorFromResponse(context(overrides)).message.replace("GET /api/v0/equity/positions ", "");
		expect(message({ status: 403, text: "Scope( portfolio ) missing for API key" })).toBe(
			'was refused: the API key does not have the "portfolio" permission.',
		);
		expect(message({ status: 403, text: "Forbidden" })).toBe("was refused: Forbidden.");
		expect(message({ status: 404 })).toBe("failed: Trading 212 has nothing at that address.");
		expect(message({ status: 408, statusText: "Request Timeout" })).toBe("failed with 408 Request Timeout.");
		expect(message({ status: 503, text: "Down for maintenance." })).toBe("failed with 503: Down for maintenance.");
		expect(message({ status: 400 })).toBe("was refused as invalid.");
	});
});

describe("errorFromResponse outside trades", () => {
	it("does not call a refused read an order rejection", () => {
		const error = errorFromResponse(context({ status: 400, text: '{"code":"MarketClosed"}' }));
		expect(error).toBeInstanceOf(ValidationError);
		expect(error).not.toBeInstanceOf(OrderRejectedError);
	});
});

interface Captured {
	readonly name: string;
	readonly status: number;
	readonly headers: Record<string, string>;
	readonly body: string;
	readonly sent?: unknown;
}

const captured = (
	JSON.parse(readFileSync(join(import.meta.dirname, "../../fixtures/errors.json"), "utf8")) as {
		results: Captured[];
	}
).results;

function replay(name: string, call: (client: Trading212) => Promise<unknown>): Promise<unknown> {
	const response = captured.find((result) => result.name === name);
	if (!response) throw new Error(`fixtures/errors.json has no "${name}"`);
	const { client } = scripted([{ status: response.status, headers: response.headers, body: response.body }], {
		retry: { maxAttempts: 1 },
	});
	return call(client).then(
		() => {
			throw new Error(`"${name}" was answered as a success`);
		},
		(error: unknown) => error,
	);
}

const limitOrder = { ticker: "AAPL_US_EQ", limitPrice: 1, timeValidity: "DAY" } as const;
const PLACE = "POST /api/v0/equity/orders/limit";

/** Each response here is one demo really sent (`npm run fixtures:capture`), replayed through the client. */
describe("responses captured from demo", () => {
	it("covers every captured response", () => {
		expect(captured.map((result) => result.name).sort()).toEqual(
			[
				"above the maximum quantity",
				"bad key",
				"below the minimum quantity",
				"buy more than the cash allows",
				"cancel missing order",
				"exports on demo",
				"exports on demo, rate limited",
				"extended hours on a limit order",
				"five decimal places",
				"limit over 50",
				"missing order",
				"sell more than owned",
				"too many requests",
			].sort(),
		);
	});

	it("a refused key, whose body is empty", async () => {
		const error = (await replay("bad key", (client) => client.account.summary())) as AuthenticationError;
		expect(error).toBeInstanceOf(AuthenticationError);
		expect(error.message).toBe(
			"GET /api/v0/equity/account/summary was refused: Trading 212 did not accept the API key and secret.",
		);
		expect(error.apiCode).toBeUndefined();
	});

	it("a missing order, read or cancelled, with its trace ID", async () => {
		const read = (await replay("missing order", (client) => client.orders.get(1))) as NotFoundError;
		expect(read).toBeInstanceOf(NotFoundError);
		expect(read.message).toBe("GET /api/v0/equity/orders/1 failed: Order not found.");
		expect(read.apiCode).toBe("entity-not-found");
		expect(read.traceId).toBe("80c2083f26f456cb2d15e418efac439c");
		const cancelled = await replay("cancel missing order", (client) => client.orders.cancel(1));
		expect(cancelled).toBeInstanceOf(NotFoundError);
		expect(cancelled).not.toBeInstanceOf(OrderOutcomeUnknownError);
	});

	/** Trading 212's own words are terse, so each refusal is said again with what was sent and the limit broken. */
	it("every order refusal, in plain words and with its number", async () => {
		const refusals = [
			{
				name: "below the minimum quantity",
				order: { ...limitOrder, quantity: 0.1 },
				reason: "min-quantity-exceeded",
				message: `${PLACE} was refused: a quantity of 0.1 is below the smallest Trading 212 accepts for this order, 1.33914872.`,
				facts: { minQuantity: 1.33914872 },
			},
			{
				name: "above the maximum quantity",
				order: { ...limitOrder, quantity: -1_000_000, limitPrice: 100_000 },
				reason: "max-quantity-exceeded",
				message: `${PLACE} was refused: a quantity of 1000000 is above the largest Trading 212 accepts in one order, 32880.`,
				facts: { maxQuantity: 32_880 },
			},
			{
				name: "sell more than owned",
				order: { ...limitOrder, quantity: -1000, limitPrice: 100_000 },
				reason: "selling-equity-not-owned",
				message: `${PLACE} was refused: it sells 1000 AAPL_US_EQ, but the account owns 0.`,
				facts: { ownedQuantity: 0 },
			},
			{
				name: "buy more than the cash allows",
				order: { ...limitOrder, quantity: 30_000, limitPrice: 6 },
				reason: "insufficient-free-for-stocks-buy",
				message: `${PLACE} was refused: there is not enough free cash to buy 30000 AAPL_US_EQ at 6 each.`,
				facts: {},
			},
		] as const;
		for (const refusal of refusals) {
			const error = (await replay(refusal.name, (client) => client.orders.limit(refusal.order))) as OrderRejectedError;
			expect(error, refusal.name).toBeInstanceOf(OrderRejectedError);
			expect(error.reason).toBe(refusal.reason);
			expect(error.message).toBe(refusal.message);
			expect(error.hint).toBe(ORDER_REJECTION_HINTS[refusal.reason]);
			expect(error).toMatchObject(refusal.facts);
			expect(error.traceId).toMatch(/^[0-9a-f]{32}$/);
		}
	});

	// The client refuses 5 decimal places before sending, so this one is mapped straight from what demo was sent.
	it("a quantity with too many decimal places", () => {
		const response = captured.find((result) => result.name === "five decimal places");
		const error = errorFromResponse(
			context({
				status: response?.status ?? 0,
				text: response?.body ?? "",
				kind: "trade",
				request: { method: "POST", path: "/api/v0/equity/orders/limit", endpoint: "placeLimitOrder" },
				sent: response?.sent,
			}),
		) as OrderRejectedError;
		expect(error.reason).toBe("quantity-precision-mismatch");
		expect(error.maxDecimals).toBe(4);
		expect(error.message).toBe(
			`${PLACE} was refused: a quantity of 5.12345 has more decimal places than the 4 Trading 212 allows.`,
		);
	});

	it("an order whose fields Trading 212 could not accept", async () => {
		const error = (await replay("extended hours on a limit order", (client) =>
			client.orders.limit({ ...limitOrder, quantity: 5 }),
		)) as ValidationError;
		expect(error).toBeInstanceOf(ValidationError);
		expect(error).not.toBeInstanceOf(OrderRejectedError);
		expect(error.message).toBe(
			`${PLACE} was refused as invalid: Trading 212 could not accept the fields sent ("Invalid payload").`,
		);
		expect(error.hint).toContain("open an issue");
	});

	it("a history page that asked for too much", async () => {
		const error = (await replay("limit over 50", (client) =>
			client.history.orders.list({ limit: 50 }),
		)) as ValidationError;
		expect(error).toBeInstanceOf(ValidationError);
		expect(error.message).toBe(
			"GET /api/v0/equity/history/orders was refused as invalid: Limit cannot be greater than 50.",
		);
	});

	it("exports, which demo does not offer", async () => {
		const error = await replay("exports on demo", (client) => client.reports.list());
		expect(error).toBeInstanceOf(NotAvailableInDemoError);
		expect((error as NotAvailableInDemoError).message).toBe(
			"GET /api/v0/equity/history/exports was refused: Trading 212 does not allow this on a demo account.",
		);
	});

	it("a 429 with rate-limit headers, and one without", async () => {
		const withHeaders = (await replay("too many requests", (client) => client.orders.get(1))) as RateLimitError;
		expect(withHeaders).toBeInstanceOf(RateLimitError);
		expect(withHeaders.apiCode).toBe("TooManyRequests");
		expect(withHeaders.message).toBe(
			"GET /api/v0/equity/orders/1 was refused: too many requests (the limit is 1 per 1 s).",
		);
		expect(withHeaders.resetAt?.getTime()).toBe(1_794_098_922_000);
		const without = (await replay("exports on demo, rate limited", (client) =>
			client.reports.list(),
		)) as RateLimitError;
		expect(without).toBeInstanceOf(RateLimitError);
		expect(without.rateLimit).toBeUndefined();
		expect(without.message).toBe("GET /api/v0/equity/history/exports was refused: too many requests.");
	});

	it("rate-limit headers, whose reset is in Unix seconds and period in seconds", () => {
		const headers = captured.find((result) => result.name === "missing order")?.headers ?? {};
		expect(parseRateLimitHeaders(new Headers(headers))).toEqual({
			limit: 1,
			periodMs: 1000,
			remaining: 0,
			used: 1,
			resetAt: 1_794_098_898_000,
		});
	});
});
