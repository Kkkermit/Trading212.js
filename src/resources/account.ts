import { ENDPOINTS } from "../http/endpoints.generated";
import type { CallOptions } from "../http/transport";
import type { AccountSummary } from "../types/api.generated";

import type { ResourceContext } from "./context";

export class AccountResource {
	readonly #context: ResourceContext;

	constructor(context: ResourceContext) {
		this.#context = context;
	}

	/**
	 * Cash, invested capital, profit and loss, and total value, in the account's primary currency.
	 *
	 * Scope `account` · 1 request / 5 s.
	 *
	 * @example
	 * const { totalValue, currency } = await t212.account.summary();
	 */
	async summary(options: CallOptions = {}): Promise<AccountSummary> {
		const { data } = await this.#context.transport.request<AccountSummary>(ENDPOINTS.getAccountSummary, options);
		return data;
	}
}
