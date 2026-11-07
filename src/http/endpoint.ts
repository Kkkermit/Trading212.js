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
