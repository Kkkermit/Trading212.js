import { describe, expect, it } from "vitest";

import {
	ConfigurationError,
	isTrading212Error,
	MissingScopeError,
	NotFoundError,
	OrderRejectedError,
	RateLimitError,
	TimeoutError,
	Trading212Error,
	ValidationError,
} from "../../src/errors/errors";

describe("error classes", () => {
	it("are instances of every class above them", () => {
		const error = new OrderRejectedError("no", { reason: "MarketClosed" });
		expect(error).toBeInstanceOf(OrderRejectedError);
		expect(error).toBeInstanceOf(ValidationError);
		expect(error).toBeInstanceOf(Trading212Error);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(NotFoundError);
		expect(error.name).toBe("OrderRejectedError");
		expect(error.code).toBe("order_rejected");
	});

	it("recognise an error from another copy of the package by its brand", () => {
		const foreign = Object.create(null) as Record<symbol, unknown>;
		Object.defineProperty(foreign, Symbol.for("trading212.js/error"), {
			value: ["MissingScopeError", "Trading212Error"],
		});
		expect(foreign instanceof MissingScopeError).toBe(true);
		expect(foreign instanceof Trading212Error).toBe(true);
		expect(foreign instanceof RateLimitError).toBe(false);
		expect(isTrading212Error(foreign)).toBe(true);
		expect(isTrading212Error(new Error("plain"))).toBe(false);
		expect(isTrading212Error(null)).toBe(false);
		expect(new Error("plain") instanceof Trading212Error).toBe(false);
	});

	it("produce a plain log record with only the fields that have values", () => {
		const error = new TimeoutError("slow", { status: 408, hint: "wait", cause: new TypeError("boom") });
		expect(error.toLog()).toEqual({
			name: "TimeoutError",
			message: "slow",
			code: "timeout",
			hint: "wait",
			status: 408,
			cause: "TypeError: boom",
		});
		expect(JSON.parse(JSON.stringify(error))).toMatchObject({ code: "timeout" });
		expect(new TimeoutError("x", { cause: "text" }).toLog().cause).toBe("text");
		expect(new TimeoutError("x", { cause: 42 }).toLog().cause).toBe("[non-error cause]");
	});

	it("carry their extra fields", () => {
		expect(new ConfigurationError("x", { field: "apiKey" }).field).toBe("apiKey");
		expect(new RateLimitError("x", { resetAt: 5000, retryAfterMs: 10 }).resetAt?.getTime()).toBe(5000);
		expect(new RateLimitError("x", {}).resetAt).toBeUndefined();
		expect(new ValidationError("x").issues).toEqual([]);
	});
});
