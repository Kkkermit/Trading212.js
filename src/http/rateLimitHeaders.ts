/** What the `x-ratelimit-*` headers said about an endpoint's budget. Absent headers leave fields undefined. */
export interface RateLimitInfo {
	/** Requests allowed per period. */
	readonly limit?: number;
	/** Length of the period, in milliseconds. */
	readonly periodMs?: number;
	/** Requests left in this period. */
	readonly remaining?: number;
	/** Requests already made in this period. */
	readonly used?: number;
	/** When the budget fully resets, as epoch milliseconds. */
	readonly resetAt?: number;
}

function numberHeader(headers: Headers, name: string): number | undefined {
	const raw = headers.get(name);
	if (raw === null || raw.trim() === "") return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

export function parseRateLimitHeaders(headers: Headers): RateLimitInfo | undefined {
	const limit = numberHeader(headers, "x-ratelimit-limit");
	const period = numberHeader(headers, "x-ratelimit-period");
	const remaining = numberHeader(headers, "x-ratelimit-remaining");
	const used = numberHeader(headers, "x-ratelimit-used");
	const reset = numberHeader(headers, "x-ratelimit-reset");
	if ([limit, period, remaining, used, reset].every((value) => value === undefined)) return undefined;
	return {
		...(limit !== undefined && { limit }),
		...(period !== undefined && { periodMs: period * 1000 }),
		...(remaining !== undefined && { remaining }),
		...(used !== undefined && { used }),
		// The docs say Unix seconds; a value that already looks like milliseconds is taken as it is.
		...(reset !== undefined && { resetAt: reset > 1e12 ? reset : reset * 1000 }),
	};
}
