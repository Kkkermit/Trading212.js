import { ENDPOINTS } from "../http/endpoints.generated";
import type { CallOptions } from "../http/transport";
import type { Position } from "../types/api.generated";

import type { ResourceContext } from "./context";

export class PositionsResource {
	readonly #context: ResourceContext;

	constructor(context: ResourceContext) {
		this.#context = context;
	}

	/**
	 * Every open position, or just one ticker's.
	 *
	 * Scope `portfolio` · 1 request / 1 s.
	 */
	async list(options: CallOptions & { ticker?: string } = {}): Promise<Position[]> {
		const { ticker, ...call } = options;
		const { data } = await this.#context.transport.request<Position[] | undefined>(ENDPOINTS.listPositions, {
			...call,
			query: { ticker },
		});
		return Array.isArray(data) ? data : [];
	}

	/** One ticker's position, or `undefined` when you hold none. */
	async get(ticker: string, options: CallOptions = {}): Promise<Position | undefined> {
		const positions = await this.list({ ...options, ticker });
		// Matched by ticker rather than trusting the filter, so another holding is never returned in its place.
		return positions.find((position) => position.instrument?.ticker === ticker);
	}
}
