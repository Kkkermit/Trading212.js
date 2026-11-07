import { NetworkError, RateLimitError, ServerError, TimeoutError } from "../errors/errors";

/** Retries apply to reads only. Orders, cancellations and pie changes are never retried. */
export interface RetryOptions {
	/** Total tries, including the first. Default 3. */
	maxAttempts?: number;
	/** The first backoff, doubled on each retry, with full jitter. Default 500 ms. */
	baseDelayMs?: number;
	/** The longest backoff. Default 10 s. */
	maxDelayMs?: number;
}

export interface ResolvedRetry {
	readonly maxAttempts: number;
	readonly baseDelayMs: number;
	readonly maxDelayMs: number;
}

export const DEFAULT_RETRY: ResolvedRetry = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10_000 };

export function isRetryable(error: unknown): boolean {
	return (
		error instanceof TimeoutError ||
		error instanceof ServerError ||
		error instanceof RateLimitError ||
		error instanceof NetworkError
	);
}

/** How long to wait before try number `attempt + 1`. A 429 waits for its reset rather than guessing. */
export function retryDelay(attempt: number, retry: ResolvedRetry, error: unknown, random = Math.random): number {
	const ceiling = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1));
	const jitter = Math.floor(random() * ceiling);
	if (error instanceof RateLimitError && error.retryAfterMs !== undefined) {
		return error.retryAfterMs + Math.floor(random() * 250);
	}
	return jitter;
}
