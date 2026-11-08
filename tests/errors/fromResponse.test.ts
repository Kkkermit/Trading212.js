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
		).toMatchObject({ apiCode: "BusinessException", message: "too many requests" });
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
		expect(error.message).toBe("GET /api/v0/equity/positions failed with 401 Unauthorized");
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

/** Each response here is one demo really sent (`npm run fixtures:capture`), replayed through the client. */
describe("responses captured from demo", () => {
	it("covers every captured response", () => {
		expect(captured.map((result) => result.name).sort()).toEqual(
			[
				"bad key",
				"cancel missing order",
				"exports on demo",
				"extended hours on a limit order",
				"below the minimum quantity",
				"limit over 50",
				"missing order",
				"above the maximum quantity",
			].sort(),
		);
	});

	it("a refused key, whose body is empty", async () => {
		const error = (await replay("bad key", (client) => client.account.summary())) as AuthenticationError;
		expect(error).toBeInstanceOf(AuthenticationError);
		expect(error.apiCode).toBeUndefined();
	});

	it("a missing order, read or cancelled, with its trace ID", async () => {
		const read = (await replay("missing order", (client) => client.orders.get(1))) as NotFoundError;
		expect(read).toBeInstanceOf(NotFoundError);
		expect(read.apiCode).toBe("entity-not-found");
		expect(read.message).toMatch(/: Order not found$/);
		expect(read.traceId).toBe("002fc4767c1b3a9e8b0ba5237bc49a2e");
		const cancelled = await replay("cancel missing order", (client) => client.orders.cancel(1));
		expect(cancelled).toBeInstanceOf(NotFoundError);
		expect(cancelled).not.toBeInstanceOf(OrderOutcomeUnknownError);
	});

	it("an order below the minimum quantity", async () => {
		const error = (await replay("below the minimum quantity", (client) =>
			client.orders.limit({ ...limitOrder, quantity: 0.1 }),
		)) as OrderRejectedError;
		expect(error).toBeInstanceOf(OrderRejectedError);
		expect(error.reason).toBe("min-quantity-exceeded");
		expect(error.hint).toBe(ORDER_REJECTION_HINTS["min-quantity-exceeded"]);
		expect(error.message).toMatch(/must trade at least 1\.33914872$/);
	});

	it("an order above the maximum quantity, with the Java Optional tidied away", async () => {
		const error = (await replay("above the maximum quantity", (client) =>
			client.orders.limit({ ...limitOrder, quantity: -10 }),
		)) as OrderRejectedError;
		expect(error.reason).toBe("max-quantity-exceeded");
		expect(error.message).toMatch(/single order is 32880$/);
	});

	it("an order whose payload Trading 212 could not accept", async () => {
		const error = await replay("extended hours on a limit order", (client) =>
			client.orders.limit({ ...limitOrder, quantity: 0.1 }),
		);
		expect(error).toBeInstanceOf(ValidationError);
		expect(error).not.toBeInstanceOf(OrderRejectedError);
	});

	it("a history page that asked for too much", async () => {
		const error = (await replay("limit over 50", (client) =>
			client.history.orders.list({ limit: 50 }),
		)) as ValidationError;
		expect(error).toBeInstanceOf(ValidationError);
		expect(error.message).toMatch(/Limit cannot be greater than 50$/);
	});

	it("a 429 that carries no rate-limit headers", async () => {
		const error = (await replay("exports on demo", (client) => client.reports.list())) as RateLimitError;
		expect(error).toBeInstanceOf(RateLimitError);
		expect(error.rateLimit).toBeUndefined();
		expect(error.message).toMatch(/too many requests$/);
	});

	it("rate-limit headers, whose reset is in Unix seconds and period in seconds", () => {
		const headers = captured.find((result) => result.name === "missing order")?.headers ?? {};
		expect(parseRateLimitHeaders(new Headers(headers))).toEqual({
			limit: 1,
			periodMs: 1000,
			remaining: 0,
			used: 1,
			resetAt: 1_794_097_875_000,
		});
	});
});
