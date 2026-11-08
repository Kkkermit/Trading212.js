import { describe, expect, it } from "vitest";

import type { EndpointDefinition } from "../../src/http/endpoint";
import { ENDPOINTS } from "../../src/http/endpoints.generated";
import { RateLimiter } from "../../src/http/rateLimiter";

const FOUR_PER_SECOND: EndpointDefinition = {
	...ENDPOINTS.listPositions,
	id: "test",
	rateLimit: { requests: 4, periodMs: 1000 },
};

const waits = (limiter: RateLimiter, times: number, now: number): number[] =>
	Array.from({ length: times }, () => limiter.reserve(FOUR_PER_SECOND, now).waitMs);

describe("RateLimiter", () => {
	it("paces calls evenly across the period", () => {
		const limiter = new RateLimiter("pace", "pace");
		expect(waits(limiter, 4, 1000)).toEqual([0, 250, 500, 750]);
		expect(limiter.reserve(FOUR_PER_SECOND, 3000).waitMs).toBe(0);
	});

	it("bursts the whole allowance, then waits for the next window", () => {
		const limiter = new RateLimiter("burst", "burst");
		expect(waits(limiter, 6, 1000)).toEqual([0, 0, 0, 0, 1000, 1000]);
		expect(limiter.reserve(FOUR_PER_SECOND, 2500).waitMs).toBe(0);
	});

	it("does not wait when off, but still records what it saw", () => {
		const limiter = new RateLimiter("off", "off");
		expect(waits(limiter, 5, 0)).toEqual([0, 0, 0, 0, 0]);
		limiter.update(FOUR_PER_SECOND, { remaining: 2, resetAt: 5000 }, 0);
		expect(limiter.snapshot([FOUR_PER_SECOND]).test).toEqual({
			limit: 4,
			periodMs: 1000,
			remaining: 2,
			resetAt: new Date(5000),
		});
	});

	it("books nothing when the wait is longer than allowed", () => {
		for (const mode of ["pace", "burst"] as const) {
			const limiter = new RateLimiter(`refuse-${mode}`, mode);
			waits(limiter, 4, 0);
			const refused = limiter.reserve(FOUR_PER_SECOND, 0, 100);
			expect(refused.booked, mode).toBe(false);
			expect(refused.waitMs, mode).toBeGreaterThan(100);
			expect(limiter.reserve(FOUR_PER_SECOND, 0).waitMs, mode).toBe(refused.waitMs);
		}
	});

	/** The headers are Trading 212's truth, including spend by other programs on the same account. */
	it("holds back until the reset when the headers say nothing is left", () => {
		const pace = new RateLimiter("pace-headers", "pace");
		pace.update(FOUR_PER_SECOND, { remaining: 0, resetAt: 9000, limit: 4, periodMs: 1000 }, 1000);
		expect(pace.reserve(FOUR_PER_SECOND, 1000).waitMs).toBe(8000);

		const burst = new RateLimiter("burst-headers", "burst");
		burst.reserve(FOUR_PER_SECOND, 1000);
		burst.update(FOUR_PER_SECOND, { remaining: 1, resetAt: 1900 }, 1000);
		expect(waits(burst, 2, 1000)).toEqual([0, 1000]);
	});

	it("adopts a different limit from the headers", () => {
		const limiter = new RateLimiter("adopt", "pace");
		limiter.update(FOUR_PER_SECOND, { limit: 2, periodMs: 2000 }, 0);
		expect(waits(limiter, 2, 0)).toEqual([0, 1000]);
	});

	it("blocks after a 429 until the reset, or a period when none is known", () => {
		const limiter = new RateLimiter("limited", "burst");
		limiter.markLimited(FOUR_PER_SECOND, 5000, 1000);
		expect(limiter.reserve(FOUR_PER_SECOND, 1000).waitMs).toBe(4000);
		const unknown = new RateLimiter("limited-unknown", "pace");
		unknown.markLimited(FOUR_PER_SECOND, undefined, 1000);
		expect(unknown.reserve(FOUR_PER_SECOND, 1000).waitMs).toBe(1000);
	});

	/** Limits are per account, so two clients for the same key must share one budget. */
	it("shares one budget between limiters for the same account", () => {
		const first = new RateLimiter("shared", "pace");
		const second = new RateLimiter("shared", "pace");
		expect(first.reserve(FOUR_PER_SECOND, 0).waitMs).toBe(0);
		expect(second.reserve(FOUR_PER_SECOND, 0).waitMs).toBe(250);
		expect(new RateLimiter("other", "pace").reserve(FOUR_PER_SECOND, 0).waitMs).toBe(0);
	});
});

describe("RateLimiter corrections in burst mode", () => {
	it("does not apply the current window's count to the next one", () => {
		const limiter = new RateLimiter("future-window", "burst");
		const threePerTen: EndpointDefinition = { ...FOUR_PER_SECOND, rateLimit: { requests: 3, periodMs: 10_000 } };
		for (let call = 0; call < 4; call++) limiter.reserve(threePerTen, 0);
		for (const remaining of [2, 1, 0]) limiter.update(threePerTen, { remaining, resetAt: 10_000 }, 100);
		expect(limiter.reserve(threePerTen, 200).waitMs).toBe(9800);
	});

	it("reports how long an endpoint is blocked for", () => {
		const limiter = new RateLimiter("blocked", "pace");
		expect(limiter.blockedFor(FOUR_PER_SECOND, 0)).toBe(0);
		limiter.markLimited(FOUR_PER_SECOND, 5000, 1000);
		expect(limiter.blockedFor(FOUR_PER_SECOND, 1000)).toBe(4000);
		expect(new RateLimiter("blocked", "off").blockedFor(FOUR_PER_SECOND, 1000)).toBe(0);
	});
});
