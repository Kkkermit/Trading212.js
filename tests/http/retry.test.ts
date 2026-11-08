import { describe, expect, it } from "vitest";

import { DEFAULT_RETRY, isRetryable, retryDelay } from "../../src/http/retry";
import { NetworkError, RateLimitError, ServerError, TimeoutError, ValidationError } from "../../src/errors/errors";

describe("retry policy", () => {
	it("retries only transient failures", () => {
		expect(isRetryable(new TimeoutError("x"))).toBe(true);
		expect(isRetryable(new ServerError("x"))).toBe(true);
		expect(isRetryable(new RateLimitError("x", {}))).toBe(true);
		expect(isRetryable(new NetworkError("x", { sent: false }))).toBe(true);
		expect(isRetryable(new ValidationError("x"))).toBe(false);
		expect(isRetryable(new Error("x"))).toBe(false);
	});

	it("backs off exponentially with full jitter, capped", () => {
		expect(retryDelay(1, DEFAULT_RETRY, new ServerError("x"), () => 0.999)).toBe(499);
		expect(retryDelay(3, DEFAULT_RETRY, new ServerError("x"), () => 0.5)).toBe(1000);
		expect(retryDelay(10, DEFAULT_RETRY, new ServerError("x"), () => 0.999)).toBe(9990);
	});

	it("waits out a 429's reset instead of guessing", () => {
		expect(retryDelay(1, DEFAULT_RETRY, new RateLimitError("x", { retryAfterMs: 4000 }), () => 0)).toBe(4000);
	});
});
