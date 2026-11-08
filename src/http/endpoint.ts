export type HttpMethod = "GET" | "POST" | "DELETE";

/**
 * How an endpoint may be treated. `read` is safe to retry; `write` changes something harmless such as requesting a
 * report; `trade` moves money or holdings and is never retried and refused on live unless trading is enabled.
 */
export type EndpointKind = "read" | "write" | "trade";

export interface EndpointRateLimit {
	readonly requests: number;
	readonly periodMs: number;
}

export interface EndpointDefinition {
	readonly id: string;
	readonly method: HttpMethod;
	readonly path: string;
	/** The API key permission the endpoint needs, or `null` where the spec does not name one. */
	readonly scope: string | null;
	readonly rateLimit: EndpointRateLimit;
	readonly kind: EndpointKind;
	readonly deprecated: boolean;
	readonly summary: string;
}

/** Freezes the endpoint table and every definition in it, so its safety facts cannot be changed at run time. */
export function freezeEndpoints<T extends Record<string, EndpointDefinition>>(definitions: T): T {
	for (const definition of Object.values(definitions)) {
		Object.freeze(definition.rateLimit);
		Object.freeze(definition);
	}
	return Object.freeze(definitions);
}
