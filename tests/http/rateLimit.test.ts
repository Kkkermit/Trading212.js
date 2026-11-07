import { describe, expect, it } from "vitest";

import type { EndpointDefinition } from "../../src/http/endpoint";
import { ENDPOINTS } from "../../src/http/endpoints.generated";
import { parseRateLimitHeaders } from "../../src/http/rateLimitHeaders";
import { RateLimiter } from "../../src/http/rateLimiter";
import { DEFAULT_RETRY, isRetryable, retryDelay } from "../../src/http/retry";
import { NetworkError, RateLimitError, ServerError, TimeoutError, ValidationError } from "../../src/errors/errors";

const FOUR_PER_SECOND: EndpointDefinition = {
	...ENDPOINTS.listPositions,
	id: "test",
	rateLimit: { requests: 4, periodMs: 1000 },
};

describe("parseRateLimitHeaders", () => {
	it("reads every header, converting seconds to milliseconds", () => {
		const headers = new Headers({
			"x-ratelimit-limit": "50",
			"x-ratelimit-period": "60",
			"x-ratelimit-remaining": "49",
			"x-ratelimit-used": "1",
			"x-ratelimit-reset": "1760346100",
		});
		expect(parseRateLimitHeaders(headers)).toEqual({
			limit: 50,
			periodMs: 60_000,
			remaining: 49,
			used: 1,
			resetAt: 1_760_346_100_000,
		});
	});

	it("accepts a reset already in milliseconds, and skips junk", () => {
		expect(
			parseRateLimitHeaders(new Headers({ "x-ratelimit-reset": "1760346100000", "x-ratelimit-limit": "abc" })),
		).toEqual({
			resetAt: 1_760_346_100_000,
		});
		expect(parseRateLimitHeaders(new Headers({ "x-ratelimit-limit": " " }))).toBeUndefined();
		expect(parseRateLimitHeaders(new Headers())).toBeUndefined();
	});
});

describe("RateLimiter", () => {
	it("paces calls evenly across the period", () => {
		const limiter = new RateLimiter("pace", "pace");
		expect([0, 0, 0, 0].map(() => limiter.reserve(FOUR_PER_SECOND, 1000))).toEqual([0, 250, 500, 750]);
		expect(limiter.reserve(FOUR_PER_SECOND, 3000)).toBe(0);
	});

	it("bursts the whole allowance, then waits for the next window", () => {
		const limiter = new RateLimiter("burst", "burst");
		expect([0, 0, 0, 0, 0, 0].map(() => limiter.reserve(FOUR_PER_SECOND, 1000))).toEqual([0, 0, 0, 0, 1000, 1000]);
		expect(limiter.reserve(FOUR_PER_SECOND, 2500)).toBe(0);
	});

	it("does not wait when off, but still records what it saw", () => {
		const limiter = new RateLimiter("off", "off");
		expect([1, 2, 3, 4, 5].map(() => limiter.reserve(FOUR_PER_SECOND, 0))).toEqual([0, 0, 0, 0, 0]);
		limiter.update(FOUR_PER_SECOND, { remaining: 2, resetAt: 5000 }, 0);
		expect(limiter.snapshot([FOUR_PER_SECOND]).test).toEqual({
			limit: 4,
			periodMs: 1000,
			remaining: 2,
			resetAt: new Date(5000),
		});
	});

	/** The headers are Trading 212's truth, including spend by other programs on the same account. */
	it("holds back until the reset when the headers say nothing is left", () => {
		const pace = new RateLimiter("pace-headers", "pace");
		pace.update(FOUR_PER_SECOND, { remaining: 0, resetAt: 9000, limit: 4, periodMs: 1000 }, 1000);
		expect(pace.reserve(FOUR_PER_SECOND, 1000)).toBe(8000);

		const burst = new RateLimiter("burst-headers", "burst");
		burst.reserve(FOUR_PER_SECOND, 1000);
		burst.update(FOUR_PER_SECOND, { remaining: 1, resetAt: 1900 }, 1000);
		expect(burst.reserve(FOUR_PER_SECOND, 1000)).toBe(0);
		expect(burst.reserve(FOUR_PER_SECOND, 1000)).toBe(1000);
	});

	it("adopts a different limit from the headers", () => {
		const limiter = new RateLimiter("adopt", "pace");
		limiter.update(FOUR_PER_SECOND, { limit: 2, periodMs: 2000 }, 0);
		expect([0, 0].map(() => limiter.reserve(FOUR_PER_SECOND, 0))).toEqual([0, 1000]);
	});

	it("blocks after a 429 until the reset, or a period when none is known", () => {
		const limiter = new RateLimiter("limited", "burst");
		limiter.markLimited(FOUR_PER_SECOND, 5000, 1000);
		expect(limiter.reserve(FOUR_PER_SECOND, 1000)).toBe(4000);
		const unknown = new RateLimiter("limited-unknown", "pace");
		unknown.markLimited(FOUR_PER_SECOND, undefined, 1000);
		expect(unknown.reserve(FOUR_PER_SECOND, 1000)).toBe(1000);
	});

	/** Limits are per account, so two clients for the same key must share one budget. */
	it("shares one budget between limiters for the same account", () => {
		const first = new RateLimiter("shared", "pace");
		const second = new RateLimiter("shared", "pace");
		expect(first.reserve(FOUR_PER_SECOND, 0)).toBe(0);
		expect(second.reserve(FOUR_PER_SECOND, 0)).toBe(250);
		expect(new RateLimiter("other", "pace").reserve(FOUR_PER_SECOND, 0)).toBe(0);
	});
});

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
