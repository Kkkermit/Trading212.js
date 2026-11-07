import type { FetchLike } from "../http/transport";
import { REDACTED } from "../logging/redact";

/** A request seen by `scriptedFetch` or the fake server. The Authorization header is never recorded. */
export interface RecordedRequest {
	readonly method: string;
	readonly url: string;
	readonly path: string;
	readonly query: Readonly<Record<string, string>>;
	readonly headers: Readonly<Record<string, string>>;
	/** True when an Authorization header was sent. Its value is never kept. */
	readonly authorized: boolean;
	/** The body, parsed when it was JSON. */
	readonly body: unknown;
}

export interface ScriptedResponse {
	/** Default 200. */
	status?: number;
	/** An object or array is sent as JSON; a string as it is; `undefined` as an empty body. */
	body?: unknown;
	headers?: Record<string, string>;
}

/** A response, an error to throw as the network failure, or a function that decides from the request. */
export type ScriptStep =
	| ScriptedResponse
	| Error
	| ((request: RecordedRequest) => ScriptedResponse | Error | Promise<ScriptedResponse | Error>);

export interface ScriptedFetch {
	readonly fetch: FetchLike;
	/** Every request made so far. */
	readonly requests: readonly RecordedRequest[];
	/** How many scripted steps have not been used. */
	readonly pending: () => number;
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
	200: "OK",
	204: "No Content",
	400: "Bad Request",
	401: "Unauthorized",
	403: "Forbidden",
	404: "Not Found",
	408: "Request Timeout",
	429: "Too Many Requests",
	500: "Internal Server Error",
	502: "Bad Gateway",
	503: "Service Unavailable",
};

export async function recordRequest(input: string, init: RequestInit): Promise<RecordedRequest> {
	const url = new URL(input);
	const headers: Record<string, string> = {};
	let authorized = false;
	new Headers(init.headers).forEach((value, key) => {
		if (key === "authorization") {
			authorized = value.length > 0;
			headers[key] = REDACTED;
		} else headers[key] = value;
	});
	let body: unknown = undefined;
	if (typeof init.body === "string") {
		try {
			body = JSON.parse(init.body);
		} catch {
			body = init.body;
		}
	} else if (init.body !== undefined && init.body !== null) {
		body = await new Response(init.body).text();
	}
	return {
		method: init.method ?? "GET",
		url: url.toString(),
		path: url.pathname,
		query: Object.fromEntries(url.searchParams),
		headers,
		authorized,
		body,
	};
}

/** Builds a `Response` the way Trading 212 would send it. */
export function toResponse(scripted: ScriptedResponse): Response {
	const status = scripted.status ?? 200;
	const headers = new Headers(scripted.headers);
	let text: string | null = null;
	if (typeof scripted.body === "string") text = scripted.body;
	else if (scripted.body !== undefined) {
		text = JSON.stringify(scripted.body);
		if (!headers.has("content-type")) headers.set("content-type", "application/json");
	}
	const nullBody = status === 204 || status === 205 || status === 304;
	return new Response(nullBody ? null : text, { status, statusText: STATUS_TEXT[status] ?? "", headers });
}

/**
 * A `fetch` that answers from a script, in order, and records what it was asked. Use it to test code at the HTTP
 * level; for whole flows, `createFakeTrading212()` is usually easier.
 *
 * @example
 * const { fetch, requests } = scriptedFetch([{ body: { id: 1, currency: "GBP" } }]);
 * const t212 = new Trading212({ environment: "demo", apiKey: "k", apiSecret: "s", fetch, rateLimit: "off" });
 */
export function scriptedFetch(steps: readonly ScriptStep[]): ScriptedFetch {
	const queue = [...steps];
	const requests: RecordedRequest[] = [];
	const fetch: FetchLike = async (input, init) => {
		const request = await recordRequest(input, init);
		requests.push(request);
		if (init.signal?.aborted) throw init.signal.reason as Error;
		const step = queue.shift();
		if (step === undefined) {
			throw new Error(`scriptedFetch has no response left for ${request.method} ${request.path}.`);
		}
		const outcome = typeof step === "function" ? await step(request) : step;
		if (outcome instanceof Error) throw outcome;
		return toResponse(outcome);
	};
	return { fetch, requests, pending: () => queue.length };
}

/** A network failure shaped like Node's, with the `code` this library reads to tell "never sent" from "lost". */
export function networkError(code = "ECONNRESET"): TypeError {
	return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}
