import { ValidationError } from "../errors/errors";
import { ENDPOINTS } from "../http/endpoints.generated";
import type { CallOptions } from "../http/transport";
import type {
	AccountBucketInstrumentsDetailedResponse,
	AccountBucketResultResponse,
	PieRequest,
} from "../types/api.generated";

import type { ResourceContext } from "./context";

function checkPieId(id: unknown): number {
	if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
		throw new ValidationError("A pie ID must be a positive whole number.", {
			issues: [{ field: "id", message: "is not a valid pie ID" }],
		});
	}
	return id;
}

/**
 * Pies. Trading 212 has deprecated these endpoints: they still work but will not be updated, and may be removed. The
 * first call logs a warning. Changes count as trades, so a live client needs `trading: "enabled"`.
 */
export class PiesResource {
	readonly #context: ResourceContext;

	constructor(context: ResourceContext) {
		this.#context = context;
	}

	/** Every pie, with its progress. Scope `pies:read` · 1 request / 30 s. */
	async list(options: CallOptions = {}): Promise<AccountBucketResultResponse[]> {
		const { data } = await this.#context.transport.request<AccountBucketResultResponse[] | undefined>(
			ENDPOINTS.listPies,
			options,
		);
		return Array.isArray(data) ? data : [];
	}

	/** One pie with its instruments and settings. Scope `pies:read` · 1 request / 5 s. */
	async get(id: number, options: CallOptions = {}): Promise<AccountBucketInstrumentsDetailedResponse> {
		const { data } = await this.#context.transport.request<AccountBucketInstrumentsDetailedResponse>(ENDPOINTS.getPie, {
			...options,
			params: { id: checkPieId(id) },
		});
		return data;
	}

	/** Creates a pie. Scope `pies:write` · 1 request / 5 s. */
	async create(pie: PieRequest, options: CallOptions = {}): Promise<AccountBucketInstrumentsDetailedResponse> {
		const { data } = await this.#context.transport.request<AccountBucketInstrumentsDetailedResponse>(
			ENDPOINTS.createPie,
			{
				...options,
				body: pie,
			},
		);
		return data;
	}

	/** Changes a pie's settings or instruments. Scope `pies:write` · 1 request / 5 s. */
	async update(
		id: number,
		pie: PieRequest,
		options: CallOptions = {},
	): Promise<AccountBucketInstrumentsDetailedResponse> {
		const { data } = await this.#context.transport.request<AccountBucketInstrumentsDetailedResponse>(
			ENDPOINTS.updatePie,
			{
				...options,
				params: { id: checkPieId(id) },
				body: pie,
			},
		);
		return data;
	}

	/** Deletes a pie. Scope `pies:write` · 1 request / 5 s. */
	async delete(id: number, options: CallOptions = {}): Promise<void> {
		await this.#context.transport.request(ENDPOINTS.deletePie, { ...options, params: { id: checkPieId(id) } });
	}

	/** Copies a pie under a new name. Scope `pies:write` · 1 request / 5 s. */
	async duplicate(
		id: number,
		copy: { name?: string; icon?: string } = {},
		options: CallOptions = {},
	): Promise<AccountBucketInstrumentsDetailedResponse> {
		const { data } = await this.#context.transport.request<AccountBucketInstrumentsDetailedResponse>(
			ENDPOINTS.duplicatePie,
			{
				...options,
				params: { id: checkPieId(id) },
				body: copy,
			},
		);
		return data;
	}
}
