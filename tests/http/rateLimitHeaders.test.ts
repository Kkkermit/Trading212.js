import { describe, expect, it } from "vitest";

import { parseRateLimitHeaders } from "../../src/http/rateLimitHeaders";

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

	it("falls back to a standard Retry-After, in seconds or as a date", () => {
		expect(parseRateLimitHeaders(new Headers({ "retry-after": "30" }), 1000)).toEqual({ resetAt: 31_000 });
		expect(parseRateLimitHeaders(new Headers({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }), 0)).toEqual({
			resetAt: Date.parse("2026-10-21T07:28:00Z"),
		});
		expect(parseRateLimitHeaders(new Headers({ "retry-after": "soon" }))).toBeUndefined();
		expect(parseRateLimitHeaders(new Headers({ "retry-after": "30", "x-ratelimit-reset": "5" }), 0)).toEqual({
			resetAt: 5000,
		});
	});
});
