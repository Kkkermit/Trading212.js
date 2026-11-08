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

/** Reads the standard `Retry-After` header, in seconds or as an HTTP date, as epoch milliseconds. */
function retryAfter(headers: Headers, now: number): number | undefined {
	const raw = headers.get("retry-after")?.trim();
	if (!raw) return undefined;
	if (/^\d+$/.test(raw)) return now + Number(raw) * 1000;
	const date = Date.parse(raw);
	return Number.isNaN(date) ? undefined : date;
}

export function parseRateLimitHeaders(headers: Headers, now = Date.now()): RateLimitInfo | undefined {
	const limit = numberHeader(headers, "x-ratelimit-limit");
	const period = numberHeader(headers, "x-ratelimit-period");
	const remaining = numberHeader(headers, "x-ratelimit-remaining");
	const used = numberHeader(headers, "x-ratelimit-used");
	const resetHeader = numberHeader(headers, "x-ratelimit-reset");
	// The docs say Unix seconds; a value that already looks like milliseconds is taken as it is.
	const reset =
		resetHeader === undefined ? retryAfter(headers, now) : resetHeader > 1e12 ? resetHeader : resetHeader * 1000;
	if ([limit, period, remaining, used, reset].every((value) => value === undefined)) return undefined;
	return {
		...(limit !== undefined && { limit }),
		...(period !== undefined && { periodMs: period * 1000 }),
		...(remaining !== undefined && { remaining }),
		...(used !== undefined && { used }),
		...(reset !== undefined && { resetAt: reset }),
	};
}
