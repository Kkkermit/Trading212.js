import type { Environment } from "../environment";
import {
	isTrading212Error,
	NetworkError,
	OrderOutcomeUnknownError,
	RateLimitError,
	type RequestDescription,
	TimeoutError,
	type Trading212Error,
	TradingDisabledError,
	UnexpectedResponseError,
	ValidationError,
} from "../errors/errors";
import { errorFromResponse } from "../errors/fromResponse";
import { HINTS } from "../errors/hints";
import { durationOption } from "../internal/duration";
import { sleep } from "../internal/sleep";
import type { Logger } from "../logging/logger";
import type { Redactor } from "../logging/redact";

import type { EndpointDefinition } from "./endpoint";
import { ENDPOINTS } from "./endpoints.generated";
import { parseRateLimitHeaders, type RateLimitInfo } from "./rateLimitHeaders";
import type { EndpointBudget, RateLimiter } from "./rateLimiter";
import { isRetryable, type ResolvedRetry, retryDelay } from "./retry";

export interface RequestEvent {
	readonly endpoint: string;
	readonly method: string;
	readonly path: string;
	readonly attempt: number;
}

export interface ResponseEvent extends RequestEvent {
	readonly status: number;
	readonly durationMs: number;
	readonly rateLimit: RateLimitInfo | undefined;
}

export interface RetryEvent extends RequestEvent {
	readonly delayMs: number;
	readonly error: Trading212Error;
}

export interface RateLimitWaitEvent {
	readonly endpoint: string;
	readonly waitMs: number;
}

/** Callbacks for metrics and tracing. They receive no credentials, and an exception in one is ignored. */
export interface Hooks {
	onRequest?(event: RequestEvent): void;
	onResponse?(event: ResponseEvent): void;
	onRetry?(event: RetryEvent): void;
	onRateLimitWait?(event: RateLimitWaitEvent): void;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface TransportConfig {
	readonly environment: Environment;
	readonly origin: string;
	readonly authorization: string;
	readonly fetch: FetchLike;
	readonly timeoutMs: number;
	readonly retry: ResolvedRetry | null;
	readonly rateLimiter: RateLimiter;
	readonly maxRateLimitWaitMs: number;
	readonly logger: Logger;
	readonly hooks: Hooks;
	readonly redact: Redactor;
	/** For success bodies: removes the credentials without touching text that only looks like one. */
	readonly removeSecrets: (text: string) => string;
	readonly userAgent: string;
	readonly trading: "enabled" | "disabled";
}

export interface CallOptions {
	/** Cancels the call. A trade aborted after it was sent throws `OrderOutcomeUnknownError`. */
	signal?: AbortSignal;
	/** Overrides the client's `timeoutMs` for this call. */
	timeoutMs?: number;
}

interface RequestOptions extends CallOptions {
	params?: Record<string, string | number>;
	query?: Record<string, string | number | boolean | undefined>;
	/** An already-validated query string, used to follow pagination. */
	rawQuery?: string;
	body?: unknown;
	/** The endpoint always answers with a body, so an empty success is an error. */
	expectBody?: boolean;
}

interface TransportResponse<T> {
	readonly data: T;
	readonly status: number;
	readonly rateLimit: RateLimitInfo | undefined;
}

const MAX_ERROR_BODY = 64 * 1024;

// Failures that happen before a byte reaches Trading 212, so the request certainly did not run.
const NOT_SENT = new Set([
	"ENOTFOUND",
	"EAI_AGAIN",
	"ECONNREFUSED",
	"ENETUNREACH",
	"EHOSTUNREACH",
	"UND_ERR_CONNECT_TIMEOUT",
	"CERT_HAS_EXPIRED",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"ERR_TLS_CERT_ALTNAME_INVALID",
]);

function errorCode(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < 4 && current; depth++) {
		const code = (current as { code?: unknown }).code;
		if (typeof code === "string") return code;
		current = (current as { cause?: unknown }).cause;
	}
	return undefined;
}

export function buildPath(template: string, params: Record<string, string | number> = {}): string {
	return template.replace(/\{(\w+)\}/g, (_, name: string) => {
		const value = params[name];
		if (value === undefined || value === "") {
			throw new ValidationError(`Missing the "${name}" for ${template}.`, {
				issues: [{ field: name, message: "is required" }],
			});
		}
		return encodeURIComponent(String(value));
	});
}

function encodeQuery(query: RequestOptions["query"]): string {
	if (!query) return "";
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) search.set(key, String(value));
	}
	return search.toString();
}

/** Sends every request the client makes: authentication, budget, timeouts, retries, logging and errors. */
export class Transport {
	readonly #config: TransportConfig;
	readonly #warnedDeprecated = new Set<string>();

	constructor(config: TransportConfig) {
		this.#config = config;
	}

	get origin(): string {
		return this.#config.origin;
	}

	get tradingEnabled(): boolean {
		return this.#config.trading === "enabled";
	}

	rateLimitSnapshot(): Record<string, EndpointBudget> {
		return this.#config.rateLimiter.snapshot(Object.values(ENDPOINTS));
	}

	/** Builds a request's URL and description without sending it. */
	describe(endpoint: EndpointDefinition, options: RequestOptions = {}): RequestDescription & { url: string } {
		const path = buildPath(endpoint.path, options.params);
		const query = options.rawQuery ?? encodeQuery(options.query);
		return {
			method: endpoint.method,
			path,
			endpoint: endpoint.id,
			url: `${this.#config.origin}${path}${query ? `?${query}` : ""}`,
		};
	}

	async request<T>(endpoint: EndpointDefinition, given: RequestOptions = {}): Promise<TransportResponse<T>> {
		const { url, ...description } = this.describe(endpoint, given);
		const config = this.#config;
		const options = { ...given, timeoutMs: durationOption(given.timeoutMs, "timeoutMs") ?? config.timeoutMs };
		if (endpoint.kind === "trade" && !this.tradingEnabled) {
			throw new TradingDisabledError(`Refused to send ${description.method} ${description.path}: trading is off.`, {
				request: description,
				hint: HINTS.tradingDisabled,
			});
		}
		if (endpoint.deprecated && !this.#warnedDeprecated.has(endpoint.id)) {
			this.#warnedDeprecated.add(endpoint.id);
			config.logger.warn(`${endpoint.id} uses a deprecated Trading 212 endpoint that may be removed.`, {
				endpoint: endpoint.id,
			});
		}
		const maxAttempts = endpoint.kind === "read" && config.retry ? config.retry.maxAttempts : 1;
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.#attempt<T>(endpoint, url, description, options, attempt);
			} catch (error) {
				const { retry } = config;
				const delayMs =
					retry && attempt < maxAttempts && isRetryable(error)
						? retryDelay(attempt, retry, error)
						: Number.POSITIVE_INFINITY;
				if (delayMs > config.maxRateLimitWaitMs) {
					this.#logFailure(endpoint, description, error);
					throw error;
				}
				const event = { ...this.#event(description, attempt), delayMs, error: error as Trading212Error };
				config.logger.warn(`Retrying ${description.method} ${description.path} in ${delayMs} ms.`, {
					endpoint: endpoint.id,
					attempt,
					delayMs,
					code: (error as Trading212Error).code,
				});
				this.#hook(() => config.hooks.onRetry?.(event));
				await sleep(delayMs, options.signal);
			}
		}
	}

	// Anything that changes the account is logged at info, so a default logger keeps a record of every order.
	#logFailure(endpoint: EndpointDefinition, description: RequestDescription, error: unknown): void {
		const where = `${description.method} ${description.path}`;
		const known = isTrading212Error(error);
		const fields = {
			endpoint: endpoint.id,
			...(known && { code: error.code, status: error.status, apiCode: error.apiCode, hint: error.hint }),
		};
		if (error instanceof OrderOutcomeUnknownError) {
			this.#config.logger.warn(
				`${where} may or may not have gone through. Check orders.list() before sending it again.`,
				fields,
			);
			return;
		}
		// The library's own errors already name the request; anything else, such as an abort reason, is given it.
		const message = known
			? error.message
			: `${where} failed: ${error instanceof Error ? error.message : String(error)}`;
		this.#config.logger[endpoint.kind === "read" ? "debug" : "info"](message, fields);
	}

	#event(description: RequestDescription, attempt: number): RequestEvent {
		return {
			endpoint: description.endpoint ?? "",
			method: description.method,
			path: description.path,
			attempt,
		};
	}

	#hook(call: () => void): void {
		try {
			call();
		} catch {
			// A failing hook must not fail the request it describes.
		}
	}

	async #waitForBudget(endpoint: EndpointDefinition, description: RequestDescription, signal?: AbortSignal) {
		const config = this.#config;
		const deadline = Date.now() + config.maxRateLimitWaitMs;
		for (;;) {
			if (signal?.aborted) throw signal.reason as Error;
			const now = Date.now();
			const { waitMs, booked } = config.rateLimiter.reserve(endpoint, now, deadline - now);
			if (!booked) {
				throw new RateLimitError(
					`${description.method} ${description.path} would have to wait ${Math.ceil(waitMs / 1000)} s for rate-limit budget, longer than maxRateLimitWaitMs.`,
					{
						request: description,
						retryAfterMs: waitMs,
						resetAt: now + waitMs,
						hint: HINTS.rateLimited(endpoint.id, now + waitMs),
					},
				);
			}
			if (waitMs > 0) {
				const message = `Waiting ${waitMs} ms for ${endpoint.id}'s rate limit.`;
				if (waitMs >= 5000) config.logger.warn(message, { endpoint: endpoint.id, waitMs });
				else config.logger.debug(message, { endpoint: endpoint.id, waitMs });
				this.#hook(() => config.hooks.onRateLimitWait?.({ endpoint: endpoint.id, waitMs }));
				await sleep(waitMs, signal);
			}
			// A 429 or an empty budget may have arrived while this call waited; if so, it books again after the reset.
			if (config.rateLimiter.blockedFor(endpoint, Date.now()) <= 0) return;
		}
	}

	async #attempt<T>(
		endpoint: EndpointDefinition,
		url: string,
		description: RequestDescription,
		options: RequestOptions,
		attempt: number,
	): Promise<TransportResponse<T>> {
		const config = this.#config;
		await this.#waitForBudget(endpoint, description, options.signal);
		if (options.signal?.aborted) throw options.signal.reason as Error;

		const headers: Record<string, string> = { Authorization: config.authorization, Accept: "application/json" };
		if (options.body !== undefined) headers["Content-Type"] = "application/json";
		if (config.userAgent) headers["User-Agent"] = config.userAgent;

		const timeoutMs = options.timeoutMs ?? config.timeoutMs;
		const timeout = AbortSignal.timeout(timeoutMs);
		const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
		const event = this.#event(description, attempt);
		const level = endpoint.kind === "read" ? "debug" : "info";
		config.logger[level](`Sending ${description.method} ${description.path}`, { endpoint: endpoint.id, attempt });
		this.#hook(() => config.hooks.onRequest?.(event));
		const started = Date.now();

		let response: Response;
		let text: string;
		try {
			response = await config.fetch(url, {
				method: endpoint.method,
				headers,
				...(options.body !== undefined && { body: JSON.stringify(options.body) }),
				signal,
				redirect: "manual",
			});
		} catch (error) {
			throw this.#requestFailure(error, endpoint, description, options, timeout, timeoutMs, true);
		}

		const rateLimit = parseRateLimitHeaders(response.headers);
		if (rateLimit) config.rateLimiter.update(endpoint, rateLimit, Date.now());

		try {
			const raw = await response.text();
			// Redacted before it is cut, so a secret straddling the cut is still found whole.
			text = response.ok ? config.removeSecrets(raw) : (config.redact(raw) as string);
		} catch (error) {
			// Once Trading 212 has answered, only a client error proves a trade did not run.
			const mayHaveRun = response.status < 400 || response.status === 408 || response.status >= 500;
			throw this.#requestFailure(error, endpoint, description, options, timeout, timeoutMs, mayHaveRun);
		}

		const durationMs = Date.now() - started;
		config.logger[level](`${description.method} ${description.path} returned ${response.status} in ${durationMs} ms`, {
			endpoint: endpoint.id,
			status: response.status,
			durationMs,
			rateLimitRemaining: rateLimit?.remaining,
		});
		this.#hook(() => config.hooks.onResponse?.({ ...event, status: response.status, durationMs, rateLimit }));

		if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
			const message = `${description.method} ${description.path} answered with a redirect, which is never followed with your credentials.`;
			const details = { status: response.status, request: description, ...(rateLimit && { rateLimit }) };
			if (endpoint.kind === "trade") {
				throw new OrderOutcomeUnknownError(message, { ...details, sent: options.body, hint: HINTS.outcomeUnknown });
			}
			throw new UnexpectedResponseError(message, details);
		}

		if (!response.ok) {
			if (response.status === 429) config.rateLimiter.markLimited(endpoint, rateLimit?.resetAt, Date.now());
			throw errorFromResponse({
				status: response.status,
				statusText: response.statusText,
				text: text.slice(0, MAX_ERROR_BODY),
				request: description,
				kind: endpoint.kind,
				environment: config.environment,
				rateLimit,
				sent: options.body,
				now: Date.now(),
			});
		}

		return {
			data: this.#parse(text, endpoint, description, options, response.status) as T,
			status: response.status,
			rateLimit,
		};
	}

	#parse(
		text: string,
		endpoint: EndpointDefinition,
		description: RequestDescription,
		options: RequestOptions,
		status: number,
	): unknown {
		const where = `${description.method} ${description.path}`;
		// A success Trading 212 cannot describe means the trade has very likely gone through.
		const unreadable = (message: string, cause?: unknown): Error =>
			endpoint.kind === "trade"
				? new OrderOutcomeUnknownError(`${where} succeeded (${status}) but ${message}.`, {
						status,
						request: description,
						sent: options.body,
						body: this.#config.redact(text.slice(0, 2000)),
						hint: HINTS.outcomeUnknown,
						cause,
					})
				: new UnexpectedResponseError(`${where} ${message}.`, {
						status,
						request: description,
						body: this.#config.redact(text.slice(0, 2000)),
						cause,
					});
		if (!text.trim()) {
			if (options.expectBody) throw unreadable("returned an empty body");
			return undefined;
		}
		try {
			return JSON.parse(text);
		} catch (error) {
			throw unreadable("returned a body that is not JSON", error);
		}
	}

	#requestFailure(
		error: unknown,
		endpoint: EndpointDefinition,
		description: RequestDescription,
		options: RequestOptions,
		timeout: AbortSignal,
		timeoutMs: number,
		mayHaveRun: boolean,
	): Error {
		const trade = endpoint.kind === "trade";
		const where = `${description.method} ${description.path}`;
		if (options.signal?.aborted) {
			if (trade && mayHaveRun) {
				return new OrderOutcomeUnknownError(`${where} was aborted after it was sent.`, {
					request: description,
					sent: options.body,
					hint: HINTS.outcomeUnknown,
					cause: options.signal.reason,
				});
			}
			return options.signal.reason as Error;
		}
		if (timeout.aborted) {
			if (trade && mayHaveRun) {
				return new OrderOutcomeUnknownError(`${where} did not answer within ${timeoutMs} ms.`, {
					request: description,
					sent: options.body,
					hint: HINTS.outcomeUnknown,
				});
			}
			return new TimeoutError(`${where} did not answer within ${timeoutMs} ms.`, {
				request: description,
				hint: HINTS.timeout(endpoint.kind),
			});
		}
		const code = errorCode(error);
		const sent = !(code !== undefined && NOT_SENT.has(code));
		if (trade && sent && mayHaveRun) {
			return new OrderOutcomeUnknownError(`${where} lost its connection${code ? ` (${code})` : ""}.`, {
				request: description,
				sent: options.body,
				hint: HINTS.outcomeUnknown,
				cause: error,
			});
		}
		const failure = sent ? "the connection broke" : "could not connect";
		return new NetworkError(`${where} failed: ${failure}${code ? ` (${code})` : ""}.`, {
			request: description,
			sent,
			hint: HINTS.network(sent, endpoint.kind),
			cause: error,
		});
	}
}
