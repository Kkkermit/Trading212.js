import type { Environment } from "../environment";
import type { EndpointKind } from "../http/endpoint";
import type { RateLimitInfo } from "../http/rateLimitHeaders";

import {
	AuthenticationError,
	type ErrorDetails,
	HttpError,
	MissingScopeError,
	NotAvailableInDemoError,
	NotFoundError,
	OrderOutcomeUnknownError,
	OrderRejectedError,
	PermissionError,
	RateLimitError,
	type RequestDescription,
	ServerError,
	TimeoutError,
	type Trading212Error,
	ValidationError,
} from "./errors";
import { QUANTITY_DECIMALS } from "../orders/quantity";
import { HINTS, ORDER_REJECTION_HINTS, notFoundHint } from "./hints";

export interface ParsedErrorBody {
	/** Trading 212's own code, from `code`, or the last part of a problem-details `type`. */
	readonly apiCode?: string;
	/** The most human sentence the body offered. */
	readonly message?: string;
	/** Trading 212's reference for the request, from `traceId`. */
	readonly traceId?: string;
	/** The body as parsed JSON, or its text when it was not JSON. */
	readonly body?: unknown;
}

const MAX_MESSAGE = 500;
// Trading 212 sometimes prints a Java Optional, as in "Max quantity for single order is Optional[32880]".
const JAVA_OPTIONAL = /\bOptional\[([^\]]*)\]/g;

function lastSegment(type: string): string | undefined {
	if (type === "about:blank") return undefined;
	return type.split(/[/#]/).filter(Boolean).pop();
}

/**
 * Reads every error body shape Trading 212 is known to send: problem details (`type`, `title`, `detail`, `traceId`),
 * the older `{ code, errorMessage }` it uses for a 429, `{ code, clarification }`, plain text, and nothing at all.
 */
export function parseErrorBody(text: string): ParsedErrorBody {
	const trimmed = text.trim();
	if (!trimmed) return {};
	let json: unknown;
	try {
		json = JSON.parse(trimmed);
	} catch {
		return { message: trimmed.slice(0, MAX_MESSAGE), body: trimmed };
	}
	if (typeof json !== "object" || json === null || Array.isArray(json)) {
		return typeof json === "string" ? { message: json.slice(0, MAX_MESSAGE), body: json } : { body: json };
	}
	const record = json as Record<string, unknown>;
	const stringField = (key: string): string | undefined => {
		const value = record[key];
		return typeof value === "string" && value.trim() ? value.trim() : undefined;
	};
	const type = stringField("type");
	const traceId = stringField("traceId");
	const code = stringField("code");
	// A 429 says only BusinessException in `code`; what happened is in `context.type`.
	const context = record.context;
	const contextType =
		typeof context === "object" && context !== null ? (context as Record<string, unknown>).type : undefined;
	const apiCode =
		(code === "BusinessException" && typeof contextType === "string" && contextType.trim()
			? contextType.trim()
			: code) ??
		stringField("errorCode") ??
		(type ? lastSegment(type) : undefined);
	const message =
		stringField("detail") ??
		stringField("clarification") ??
		stringField("message") ??
		stringField("errorMessage") ??
		stringField("error") ??
		stringField("title");
	return {
		...(apiCode !== undefined && { apiCode }),
		...(message !== undefined && { message: message.replace(JAVA_OPTIONAL, "$1").slice(0, MAX_MESSAGE) }),
		...(traceId !== undefined && { traceId }),
		body: json,
	};
}

const SCOPE = /Scope\(\s*([\w:.-]+)\s*\)/i;
const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const DEMO_ONLY = normalise("not-available-in-demo-account");

type KnownRejection = keyof typeof ORDER_REJECTION_HINTS;

const KNOWN_REJECTIONS = (Object.keys(ORDER_REJECTION_HINTS) as KnownRejection[]).map(
	(reason) => [reason, normalise(reason)] as const,
);

function findRejection(haystack: string): KnownRejection | undefined {
	return KNOWN_REJECTIONS.find(([, needle]) => haystack.includes(needle))?.[0];
}

type Fact = "minQuantity" | "maxQuantity" | "maxDecimals" | "ownedQuantity";

// Where each number sits in Trading 212's message, as recorded in fixtures/errors.json.
const FACTS: Partial<Record<KnownRejection, readonly [Fact, RegExp]>> = {
	"min-quantity-exceeded": ["minQuantity", /at least\s+(\d+(?:\.\d+)?)/i],
	"max-quantity-exceeded": ["maxQuantity", /\bis\s+(\d+(?:\.\d+)?)\s*$/i],
	"quantity-precision-mismatch": ["maxDecimals", /precision\s+(\d+)/i],
	"selling-equity-not-owned": ["ownedQuantity", /owned:\s*(\d+(?:\.\d+)?)/i],
};

function factsOf(reason: KnownRejection, message: string | undefined): Partial<Record<Fact, number>> {
	const fact = FACTS[reason];
	const match = fact && message ? fact[1].exec(message) : null;
	return fact && match?.[1] ? { [fact[0]]: Number(match[1]) } : {};
}

interface SentOrder {
	readonly ticker?: string;
	readonly quantity?: number;
	readonly price?: number;
}

function sentOrder(sent: unknown): SentOrder {
	if (typeof sent !== "object" || sent === null) return {};
	const { ticker, quantity, limitPrice, stopPrice } = sent as Record<string, unknown>;
	const price = typeof limitPrice === "number" ? limitPrice : typeof stopPrice === "number" ? stopPrice : undefined;
	return {
		...(typeof ticker === "string" && { ticker }),
		...(typeof quantity === "number" && Number.isFinite(quantity) && { quantity: Math.abs(quantity) }),
		...(price !== undefined && { price }),
	};
}

/** Says in plain words what a refused order broke, using what was sent and the numbers Trading 212 gave. */
function rejectionSentence(reason: KnownRejection, facts: Partial<Record<Fact, number>>, order: SentOrder): string {
	const quantity = order.quantity === undefined ? "the quantity" : `a quantity of ${String(order.quantity)}`;
	const instrument = order.ticker ?? "this instrument";
	const shares = order.quantity === undefined ? instrument : `${String(order.quantity)} ${instrument}`;
	const named = (value: number | undefined, words: string): string =>
		value === undefined ? `the ${words}` : `the ${words}, ${String(value)}`;
	switch (reason) {
		case "min-quantity-exceeded":
			return `${quantity} is below ${named(facts.minQuantity, "smallest Trading 212 accepts for this order")}.`;
		case "max-quantity-exceeded":
			return `${quantity} is above ${named(facts.maxQuantity, "largest Trading 212 accepts in one order")}.`;
		case "quantity-precision-mismatch":
			return `${quantity} has more decimal places than the ${String(facts.maxDecimals ?? QUANTITY_DECIMALS)} Trading 212 allows.`;
		case "selling-equity-not-owned":
			return facts.ownedQuantity === undefined
				? `it sells ${shares}, more than the account owns.`
				: `it sells ${shares}, but the account owns ${String(facts.ownedQuantity)}.`;
		case "insufficient-free-for-stocks-buy":
			return `there is not enough free cash to buy ${shares}${order.price === undefined ? "" : ` at ${String(order.price)} each`}.`;
		case "market-closed":
			return `the market for ${instrument} is closed.`;
	}
}

const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

export interface ResponseContext {
	readonly status: number;
	readonly statusText: string;
	/** The raw body, already redacted. */
	readonly text: string;
	readonly request: RequestDescription;
	readonly kind: EndpointKind;
	readonly environment: Environment;
	readonly rateLimit: RateLimitInfo | undefined;
	readonly sent?: unknown;
	readonly sentAt?: number;
	readonly now: number;
}

/** Turns a failed response into the most specific error that describes it, with a message that says what went wrong. */
export function errorFromResponse(context: ResponseContext): Trading212Error {
	const { status, request, kind, environment, rateLimit } = context;
	const parsed = parseErrorBody(context.text);
	const where = `${request.method} ${request.path}`;
	const answered = `${status}${context.statusText ? ` ${context.statusText}` : ""}`;
	const said = parsed.message ? `: ${sentence(parsed.message)}` : ".";
	const searchable = normalise(`${parsed.apiCode ?? ""} ${parsed.message ?? ""} ${context.text}`);
	const details: ErrorDetails = {
		status,
		request,
		...(rateLimit && { rateLimit }),
		...(parsed.body !== undefined && { body: parsed.body }),
		...(parsed.apiCode !== undefined && { apiCode: parsed.apiCode }),
		...(parsed.traceId !== undefined && { traceId: parsed.traceId }),
	};

	if (kind === "trade" && (status === 408 || status >= 500)) {
		return new OrderOutcomeUnknownError(
			`${where} may or may not have gone through: Trading 212 answered ${answered}${parsed.message ? `: ${parsed.message}` : ""}.`,
			{
				...details,
				hint: HINTS.outcomeUnknown,
				sent: context.sent,
				...(context.sentAt !== undefined && { sentAt: context.sentAt }),
			},
		);
	}

	switch (status) {
		case 400: {
			const rejection = kind === "trade" ? findRejection(searchable) : undefined;
			if (rejection) {
				const facts = factsOf(rejection, parsed.message);
				return new OrderRejectedError(
					`${where} was refused: ${rejectionSentence(rejection, facts, sentOrder(context.sent))}`,
					{ ...details, ...facts, reason: rejection, hint: ORDER_REJECTION_HINTS[rejection] },
				);
			}
			// A malformed request is the caller's to fix, not a refusal of the order itself.
			if (parsed.apiCode && kind === "trade" && parsed.apiCode !== "invalid-request") {
				return new OrderRejectedError(`${where} was refused (${parsed.apiCode})${said}`, {
					...details,
					reason: parsed.apiCode,
					hint: HINTS.validation,
				});
			}
			const invalid =
				parsed.message === "Invalid payload"
					? `: Trading 212 could not accept the fields sent ("Invalid payload").`
					: said;
			return new ValidationError(`${where} was refused as invalid${invalid}`, {
				...details,
				hint: kind === "trade" ? HINTS.invalidOrder : HINTS.validation,
			});
		}
		case 401:
			return new AuthenticationError(`${where} was refused: Trading 212 did not accept the API key and secret.`, {
				...details,
				environment,
				hint: HINTS.authentication(environment),
			});
		case 403: {
			const scope = SCOPE.exec(`${parsed.message ?? ""} ${context.text}`)?.[1];
			if (scope) {
				return new MissingScopeError(`${where} was refused: the API key does not have the "${scope}" permission.`, {
					...details,
					scope,
					hint: HINTS.missingScope(scope),
				});
			}
			if (searchable.includes(DEMO_ONLY)) {
				return new NotAvailableInDemoError(`${where} was refused: Trading 212 does not allow this on a demo account.`, {
					...details,
					hint: HINTS.notAvailableInDemo,
				});
			}
			return new PermissionError(`${where} was refused${said}`, { ...details, hint: HINTS.permission });
		}
		case 404:
			return new NotFoundError(
				`${where} failed: ${parsed.message ? sentence(parsed.message) : "Trading 212 has nothing at that address."}`,
				{
					...details,
					hint: notFoundHint(request.endpoint),
				},
			);
		case 408:
			return new TimeoutError(`${where} failed with ${answered}${said}`, { ...details, hint: HINTS.timeout(kind) });
		case 429: {
			const resetAt = rateLimit?.resetAt;
			const retryAfterMs = resetAt === undefined ? undefined : Math.max(0, resetAt - context.now);
			const budget =
				rateLimit?.limit !== undefined && rateLimit.periodMs !== undefined
					? ` (the limit is ${String(rateLimit.limit)} per ${String(rateLimit.periodMs / 1000)} s)`
					: "";
			return new RateLimitError(`${where} was refused: too many requests${budget}.`, {
				...details,
				...(resetAt !== undefined && { resetAt }),
				...(retryAfterMs !== undefined && { retryAfterMs }),
				hint: HINTS.rateLimited(request.endpoint, resetAt),
			});
		}
		default: {
			const message = `${where} failed with ${answered}${said}`;
			if (status >= 500) return new ServerError(message, { ...details, hint: HINTS.server(kind) });
			return new HttpError(message, details);
		}
	}
}
