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
import { HINTS, ORDER_REJECTION_HINTS, notFoundHint } from "./hints";

export interface ParsedErrorBody {
	/** Trading 212's own code, from `code`, or the last part of a problem-details `type`. */
	readonly apiCode?: string;
	/** The most human sentence the body offered. */
	readonly message?: string;
	/** The body as parsed JSON, or its text when it was not JSON. */
	readonly body?: unknown;
}

const MAX_MESSAGE = 500;

function lastSegment(type: string): string | undefined {
	if (type === "about:blank") return undefined;
	return type.split(/[/#]/).filter(Boolean).pop();
}

/**
 * Reads every error body shape Trading 212 is known to send: problem details (`type`, `title`, `detail`), the older
 * `{ code, clarification }` and `{ code, message }`, plain text, and nothing at all.
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
	const apiCode = stringField("code") ?? stringField("errorCode") ?? (type ? lastSegment(type) : undefined);
	const message =
		stringField("detail") ??
		stringField("clarification") ??
		stringField("message") ??
		stringField("errorMessage") ??
		stringField("error") ??
		stringField("title");
	return {
		...(apiCode !== undefined && { apiCode }),
		...(message !== undefined && { message: message.slice(0, MAX_MESSAGE) }),
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
	readonly now: number;
}

/** Turns a failed response into the most specific error that describes it. */
export function errorFromResponse(context: ResponseContext): Trading212Error {
	const { status, request, kind, environment, rateLimit } = context;
	const parsed = parseErrorBody(context.text);
	const reason = parsed.message ? `: ${parsed.message}` : "";
	const message = `${request.method} ${request.path} failed with ${status}${context.statusText ? ` ${context.statusText}` : ""}${reason}`;
	const searchable = normalise(`${parsed.apiCode ?? ""} ${parsed.message ?? ""} ${context.text}`);
	const details: ErrorDetails = {
		status,
		request,
		...(rateLimit && { rateLimit }),
		...(parsed.body !== undefined && { body: parsed.body }),
		...(parsed.apiCode !== undefined && { apiCode: parsed.apiCode }),
	};

	if (kind === "trade" && (status === 408 || status >= 500)) {
		return new OrderOutcomeUnknownError(message, { ...details, hint: HINTS.outcomeUnknown, sent: context.sent });
	}

	switch (status) {
		case 400: {
			const rejection = kind === "trade" ? findRejection(searchable) : undefined;
			if (rejection) {
				return new OrderRejectedError(message, {
					...details,
					reason: rejection,
					hint: ORDER_REJECTION_HINTS[rejection],
				});
			}
			if (parsed.apiCode && kind === "trade") {
				return new OrderRejectedError(message, { ...details, reason: parsed.apiCode, hint: HINTS.validation });
			}
			return new ValidationError(message, { ...details, hint: HINTS.validation });
		}
		case 401:
			return new AuthenticationError(message, { ...details, environment, hint: HINTS.authentication(environment) });
		case 403: {
			const scope = SCOPE.exec(`${parsed.message ?? ""} ${context.text}`)?.[1];
			if (scope) return new MissingScopeError(message, { ...details, scope, hint: HINTS.missingScope(scope) });
			if (searchable.includes(DEMO_ONLY)) {
				return new NotAvailableInDemoError(message, { ...details, hint: HINTS.notAvailableInDemo });
			}
			return new PermissionError(message, { ...details, hint: HINTS.permission });
		}
		case 404:
			return new NotFoundError(message, { ...details, hint: notFoundHint(request.endpoint) });
		case 408:
			return new TimeoutError(message, { ...details, hint: HINTS.timeout(kind) });
		case 429: {
			const resetAt = rateLimit?.resetAt;
			const retryAfterMs = resetAt === undefined ? undefined : Math.max(0, resetAt - context.now);
			return new RateLimitError(message, {
				...details,
				...(resetAt !== undefined && { resetAt }),
				...(retryAfterMs !== undefined && { retryAfterMs }),
				hint: HINTS.rateLimited(request.endpoint, resetAt),
			});
		}
		default:
			if (status >= 500) return new ServerError(message, { ...details, hint: HINTS.server(kind) });
			return new HttpError(message, details);
	}
}
