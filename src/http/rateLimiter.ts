import type { EndpointDefinition } from "./endpoint";
import type { RateLimitInfo } from "./rateLimitHeaders";

/**
 * - `pace` (default) spreads calls evenly over each period, as Trading 212 recommends, so 429s should not happen.
 * - `burst` spends a period's whole allowance at once, then waits for the reset.
 * - `off` sends immediately and leaves 429s to the caller.
 */
export type RateLimitMode = "pace" | "burst" | "off";

interface Bucket {
	limit: number;
	periodMs: number;
	nextSlotAt: number;
	remaining: number;
	windowStartsAt: number;
	windowEndsAt: number;
	blockedUntil: number;
	lastSeen: RateLimitInfo | undefined;
}

/** What is known about one endpoint's budget right now. */
export interface EndpointBudget {
	readonly limit: number;
	readonly periodMs: number;
	/** From the last response's headers; undefined until the endpoint has been called. */
	readonly remaining: number | undefined;
	readonly resetAt: Date | undefined;
}

type Registry = Map<string, Map<string, Bucket>>;

const REGISTRY = Symbol.for("trading212.js/rate-limits");

// Shared through globalThis so every client, and every copy of the package, for one account draws on one budget.
function registry(): Registry {
	const holder = globalThis as Record<symbol, Registry | undefined>;
	holder[REGISTRY] ??= new Map();
	return holder[REGISTRY];
}

/** Forgets every budget. For tests only. */
export function resetRateLimitState(): void {
	registry().clear();
}

export class RateLimiter {
	readonly #buckets: Map<string, Bucket>;
	readonly #mode: RateLimitMode;

	constructor(accountKey: string, mode: RateLimitMode) {
		const shared = registry();
		let buckets = shared.get(accountKey);
		if (!buckets) {
			buckets = new Map();
			shared.set(accountKey, buckets);
		}
		this.#buckets = buckets;
		this.#mode = mode;
	}

	#bucket(endpoint: EndpointDefinition): Bucket {
		let bucket = this.#buckets.get(endpoint.id);
		if (!bucket) {
			bucket = {
				limit: endpoint.rateLimit.requests,
				periodMs: endpoint.rateLimit.periodMs,
				nextSlotAt: 0,
				remaining: endpoint.rateLimit.requests,
				windowStartsAt: 0,
				windowEndsAt: 0,
				blockedUntil: 0,
				lastSeen: undefined,
			};
			this.#buckets.set(endpoint.id, bucket);
		}
		return bucket;
	}

	/** Books the next slot for a call and returns how many milliseconds to wait before making it. */
	reserve(endpoint: EndpointDefinition, now: number): number {
		const bucket = this.#bucket(endpoint);
		if (this.#mode === "off") return 0;
		if (this.#mode === "pace") {
			const slot = Math.max(now, bucket.nextSlotAt, bucket.blockedUntil);
			bucket.nextSlotAt = slot + bucket.periodMs / bucket.limit;
			return slot - now;
		}
		if (bucket.blockedUntil > now && bucket.windowStartsAt < bucket.blockedUntil) {
			bucket.windowStartsAt = bucket.blockedUntil;
			bucket.windowEndsAt = bucket.blockedUntil + bucket.periodMs;
			bucket.remaining = bucket.limit;
		}
		if (now >= bucket.windowEndsAt) {
			bucket.windowStartsAt = now;
			bucket.windowEndsAt = now + bucket.periodMs;
			bucket.remaining = bucket.limit;
		}
		if (bucket.remaining > 0) {
			bucket.remaining--;
			return Math.max(0, bucket.windowStartsAt - now);
		}
		// This window is spent: book the first place in the next one.
		bucket.windowStartsAt = bucket.windowEndsAt;
		bucket.windowEndsAt += bucket.periodMs;
		bucket.remaining = bucket.limit - 1;
		return bucket.windowStartsAt - now;
	}

	/** Corrects the budget from what Trading 212's headers said, which beats the documented figures. */
	update(endpoint: EndpointDefinition, info: RateLimitInfo, now: number): void {
		const bucket = this.#bucket(endpoint);
		bucket.lastSeen = info;
		if (info.limit !== undefined && info.limit > 0) bucket.limit = info.limit;
		if (info.periodMs !== undefined && info.periodMs > 0) bucket.periodMs = info.periodMs;
		if (info.resetAt !== undefined && info.resetAt > now) {
			if (info.remaining === 0) bucket.blockedUntil = Math.max(bucket.blockedUntil, info.resetAt);
			if (info.remaining !== undefined && now < bucket.windowEndsAt) {
				bucket.remaining = Math.min(bucket.remaining, info.remaining);
			}
		}
	}

	/** Records a 429: nothing more is sent to the endpoint until the reset. */
	markLimited(endpoint: EndpointDefinition, resetAt: number | undefined, now: number): void {
		const bucket = this.#bucket(endpoint);
		bucket.blockedUntil = Math.max(bucket.blockedUntil, resetAt ?? now + bucket.periodMs);
	}

	snapshot(endpoints: readonly EndpointDefinition[]): Record<string, EndpointBudget> {
		const out: Record<string, EndpointBudget> = {};
		for (const endpoint of endpoints) {
			const bucket = this.#bucket(endpoint);
			out[endpoint.id] = {
				limit: bucket.limit,
				periodMs: bucket.periodMs,
				remaining: bucket.lastSeen?.remaining,
				resetAt: bucket.lastSeen?.resetAt === undefined ? undefined : new Date(bucket.lastSeen.resetAt),
			};
		}
		return out;
	}
}
