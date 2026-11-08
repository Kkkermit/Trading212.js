import type { Environment } from "../environment";
import type { RateLimitInfo } from "../http/rateLimitHeaders";

const BRAND = Symbol.for("trading212.js/error");

/** A stable, machine-readable name for what went wrong. */
export type ErrorCode =
	| "configuration"
	| "authentication"
	| "missing_scope"
	| "not_available_in_demo"
	| "permission"
	| "validation"
	| "order_rejected"
	| "not_found"
	| "instrument_not_found"
	| "rate_limited"
	| "timeout"
	| "outcome_unknown"
	| "trading_disabled"
	| "network"
	| "server"
	| "http_error"
	| "unexpected_response";

/** The request an error came from. Never holds headers or credentials. */
export interface RequestDescription {
	readonly method: string;
	readonly path: string;
	/** The library's name for the endpoint, such as `placeLimitOrder`. */
	readonly endpoint?: string;
}

export interface ErrorDetails {
	hint?: string;
	status?: number;
	request?: RequestDescription;
	rateLimit?: RateLimitInfo;
	/** The response body, parsed when it was JSON and always redacted. */
	body?: unknown;
	/** The error code Trading 212 put in the body, such as `min-quantity-exceeded`. */
	apiCode?: string;
	/** Trading 212's reference for the failed request, worth quoting if you contact its support. */
	traceId?: string;
	cause?: unknown;
}

function kindsOf(constructor: unknown): string[] {
	const kinds: string[] = [];
	let current = constructor as { kind?: unknown } | null;
	while (current && Object.hasOwn(current, "kind")) {
		kinds.push(String(current.kind));
		current = Object.getPrototypeOf(current) as { kind?: unknown } | null;
	}
	return kinds;
}

function brandOf(value: unknown): string[] | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const kinds = (value as Record<symbol, unknown>)[BRAND];
	return Array.isArray(kinds) ? (kinds as string[]) : undefined;
}

/**
 * The base of every error this library throws. `instanceof` works on it and on every subclass even when two copies
 * of the package are loaded (ESM beside CJS), because the check reads a brand rather than the prototype chain.
 */
export class Trading212Error extends Error {
	static readonly kind: string = "Trading212Error";

	readonly code: ErrorCode;
	/** What to do about it, in plain English. */
	readonly hint: string | undefined;
	readonly status: number | undefined;
	readonly request: RequestDescription | undefined;
	readonly rateLimit: RateLimitInfo | undefined;
	readonly body: unknown;
	readonly apiCode: string | undefined;
	/** Trading 212's reference for the failed request, worth quoting if you contact its support. */
	readonly traceId: string | undefined;
	/** Set when a paginated read failed part-way: pass it as `cursor` to carry on from where it stopped. */
	resumeCursor: string | undefined;

	constructor(message: string, code: ErrorCode, details: ErrorDetails = {}) {
		super(message, details.cause === undefined ? undefined : { cause: details.cause });
		const kinds = kindsOf(new.target);
		this.name = kinds[0] ?? "Trading212Error";
		this.code = code;
		this.hint = details.hint;
		this.status = details.status;
		this.request = details.request;
		this.rateLimit = details.rateLimit;
		this.body = details.body;
		this.apiCode = details.apiCode;
		this.traceId = details.traceId;
		this.resumeCursor = undefined;
		Object.defineProperty(this, BRAND, { value: kinds, enumerable: false });
	}

	static override [Symbol.hasInstance](value: unknown): boolean {
		const kinds = brandOf(value);
		if (kinds) return kinds.includes(this.kind);
		return Function.prototype[Symbol.hasInstance].call(this, value);
	}

	/** A plain, redacted object for structured logs: every field that has a value, plus the cause's message. */
	toLog(): Record<string, unknown> {
		const fields: Record<string, unknown> = { name: this.name, message: this.message };
		for (const [key, value] of Object.entries(this)) {
			if (value !== undefined) fields[key] = value;
		}
		if (this.cause !== undefined) {
			const cause: unknown = this.cause;
			fields.cause =
				cause instanceof Error
					? `${cause.name}: ${cause.message}`
					: typeof cause === "string"
						? cause
						: "[non-error cause]";
		}
		return fields;
	}

	toJSON(): Record<string, unknown> {
		return this.toLog();
	}
}

/** True for any error this library threw, from any copy of the package. */
export function isTrading212Error(value: unknown): value is Trading212Error {
	return brandOf(value) !== undefined;
}

/** The options passed to the client, or the environment variables behind them, are wrong. No request was made. */
export class ConfigurationError extends Trading212Error {
	static override readonly kind = "ConfigurationError";
	/** The option at fault, such as `apiKey`. */
	readonly field: string | undefined;

	constructor(message: string, details: ErrorDetails & { field?: string } = {}) {
		super(message, "configuration", details);
		this.field = details.field;
	}
}

/** 401: Trading 212 did not accept the key and secret. */
export class AuthenticationError extends Trading212Error {
	static override readonly kind = "AuthenticationError";
	readonly environment: Environment;

	constructor(message: string, details: ErrorDetails & { environment: Environment }) {
		super(message, "authentication", details);
		this.environment = details.environment;
	}
}

/** 403 with a missing permission: the key exists but was not given this scope. */
export class MissingScopeError extends Trading212Error {
	static override readonly kind = "MissingScopeError";
	/** The permission the key lacks, such as `orders:execute`. */
	readonly scope: string;

	constructor(message: string, details: ErrorDetails & { scope: string }) {
		super(message, "missing_scope", details);
		this.scope = details.scope;
	}
}

/** 403 for a feature that only exists on live, such as CSV exports. */
export class NotAvailableInDemoError extends Trading212Error {
	static override readonly kind = "NotAvailableInDemoError";

	constructor(message: string, details: ErrorDetails = {}) {
		super(message, "not_available_in_demo", details);
	}
}

/** Any other 403, for example a key restricted to IP addresses this machine is not on. */
export class PermissionError extends Trading212Error {
	static override readonly kind = "PermissionError";

	constructor(message: string, details: ErrorDetails = {}) {
		super(message, "permission", details);
	}
}

export interface ValidationIssue {
	readonly field: string;
	readonly message: string;
}

/** The request was invalid: caught here before sending, or refused by Trading 212 with a 400. */
export class ValidationError extends Trading212Error {
	static override readonly kind: string = "ValidationError";
	readonly issues: readonly ValidationIssue[];

	constructor(message: string, details: ErrorDetails & { issues?: readonly ValidationIssue[] } = {}, code?: ErrorCode) {
		super(message, code ?? "validation", details);
		this.issues = details.issues ?? [];
	}
}

/** Why Trading 212 refused an order, spelt as its error bodies spell it; an unknown reason arrives as its raw code. */
export type OrderRejectionReason =
	| "min-quantity-exceeded"
	| "max-quantity-exceeded"
	| "insufficient-free-for-stocks-buy"
	| "selling-equity-not-owned"
	| "market-closed"
	| "quantity-precision-mismatch"
	| (string & {});

/** Trading 212 refused an order for a business reason, such as not enough cash. Nothing was traded. */
export class OrderRejectedError extends ValidationError {
	static override readonly kind = "OrderRejectedError";
	readonly reason: OrderRejectionReason;
	/** The smallest quantity Trading 212 accepts for this order, read from a `min-quantity-exceeded` refusal. */
	readonly minQuantity: number | undefined;
	/** The largest quantity it accepts in one order, read from a `max-quantity-exceeded` refusal. */
	readonly maxQuantity: number | undefined;
	/** The most decimal places a quantity may have, read from a `quantity-precision-mismatch` refusal. */
	readonly maxDecimals: number | undefined;
	/** How many shares Trading 212 says the account owns, read from a `selling-equity-not-owned` refusal. */
	readonly ownedQuantity: number | undefined;

	constructor(
		message: string,
		details: ErrorDetails & {
			reason: OrderRejectionReason;
			minQuantity?: number;
			maxQuantity?: number;
			maxDecimals?: number;
			ownedQuantity?: number;
		},
	) {
		super(message, details, "order_rejected");
		this.reason = details.reason;
		this.minQuantity = details.minQuantity;
		this.maxQuantity = details.maxQuantity;
		this.maxDecimals = details.maxDecimals;
		this.ownedQuantity = details.ownedQuantity;
	}
}

/** 404: the order, pie or other resource does not exist (any more). */
export class NotFoundError extends Trading212Error {
	static override readonly kind: string = "NotFoundError";

	constructor(message: string, details: ErrorDetails = {}, code?: ErrorCode) {
		super(message, code ?? "not_found", details);
	}
}

export interface InstrumentSuggestion {
	readonly ticker: string;
	readonly name: string | undefined;
}

/** No instrument matched, or several did equally well. `suggestions` lists the closest. */
export class InstrumentNotFoundError extends NotFoundError {
	static override readonly kind = "InstrumentNotFoundError";
	readonly query: string;
	readonly suggestions: readonly InstrumentSuggestion[];

	constructor(
		message: string,
		details: ErrorDetails & { query: string; suggestions: readonly InstrumentSuggestion[] },
	) {
		super(message, details, "instrument_not_found");
		this.query = details.query;
		this.suggestions = details.suggestions;
	}
}

/** 429, or a client-side wait for budget that would have been longer than allowed. */
export class RateLimitError extends Trading212Error {
	static override readonly kind = "RateLimitError";
	/** How long to wait before the next try. */
	readonly retryAfterMs: number | undefined;
	/** When the budget resets. */
	readonly resetAt: Date | undefined;

	constructor(message: string, details: ErrorDetails & { retryAfterMs?: number; resetAt?: number }) {
		super(message, "rate_limited", details);
		this.retryAfterMs = details.retryAfterMs;
		this.resetAt = details.resetAt === undefined ? undefined : new Date(details.resetAt);
	}
}

/** The request took too long: a 408 from Trading 212, or the client's own `timeoutMs`. */
export class TimeoutError extends Trading212Error {
	static override readonly kind = "TimeoutError";

	constructor(message: string, details: ErrorDetails = {}) {
		super(message, "timeout", details);
	}
}

/** An order, cancellation or pie change may or may not have happened. Check `orders.list()` before resending. */
export class OrderOutcomeUnknownError extends Trading212Error {
	static override readonly kind = "OrderOutcomeUnknownError";
	/** What was sent, so it can be looked for. */
	readonly sent: unknown;

	constructor(message: string, details: ErrorDetails & { sent?: unknown }) {
		super(message, "outcome_unknown", details);
		this.sent = details.sent;
	}
}

/** A trade was refused before sending because trading is off for this client, the default on live. */
export class TradingDisabledError extends Trading212Error {
	static override readonly kind = "TradingDisabledError";

	constructor(message: string, details: ErrorDetails = {}) {
		super(message, "trading_disabled", details);
	}
}

/** The connection failed. `sent` is false when it failed before reaching Trading 212, such as a DNS failure. */
export class NetworkError extends Trading212Error {
	static override readonly kind = "NetworkError";
	readonly sent: boolean;

	constructor(message: string, details: ErrorDetails & { sent: boolean }) {
		super(message, "network", details);
		this.sent = details.sent;
	}
}

/** 5xx: Trading 212 had a problem of its own. */
export class ServerError extends Trading212Error {
	static override readonly kind = "ServerError";

	constructor(message: string, details: ErrorDetails = {}) {
		super(message, "server", details);
	}
}

/** Any other non-success status. */
export class HttpError extends Trading212Error {
	static override readonly kind = "HttpError";

	constructor(message: string, details: ErrorDetails = {}) {
		super(message, "http_error", details);
	}
}

/** A success response this library could not read, or a redirect it refused to follow with your credentials. */
export class UnexpectedResponseError extends Trading212Error {
	static override readonly kind = "UnexpectedResponseError";

	constructor(message: string, details: ErrorDetails = {}) {
		super(message, "unexpected_response", details);
	}
}
