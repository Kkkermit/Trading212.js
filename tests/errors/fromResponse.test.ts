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
				'{"type":"/api-errors/not-available-in-demo-account","title":"Nope","status":403,"detail":"Not in demo"}',
			),
		).toMatchObject({ apiCode: "not-available-in-demo-account", message: "Not in demo" });
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

	it("names known order rejections, wherever the code appears", () => {
		for (const [text, reason] of [
			['{"code":"InsufficientFreeForStocksBuy"}', "InsufficientFreeForStocksBuy"],
			['{"code":"SellingEquityNotOwned"}', "SellingEquityNotOwned"],
			['{"code":"MarketClosed","clarification":"closed"}', "MarketClosed"],
			['{"type":"/api-errors/quantity-precision-mismatch"}', "QuantityPrecisionMismatch"],
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
