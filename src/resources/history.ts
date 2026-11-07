import { ENDPOINTS } from "../http/endpoints.generated";
import { PagedList } from "../pagination";
import type { HistoricalOrder, HistoryDividendItem, HistoryTransactionItem } from "../types/api.generated";

import type { ResourceContext } from "./context";

/** Your account's past: filled and cancelled orders, dividends, and cash movements. Newest first. */
export class HistoryResource {
	/**
	 * Orders that have finished, with their fills.
	 *
	 * Scope `history:orders` · 20 requests / minute.
	 *
	 * @example
	 * for await (const { order, fill } of t212.history.orders.all({ ticker: "AAPL_US_EQ" })) console.log(order?.status, fill?.price);
	 */
	readonly orders: PagedList<HistoricalOrder, { ticker?: string }>;

	/**
	 * Dividends paid out.
	 *
	 * Scope `history:dividends` · 20 requests / minute.
	 */
	readonly dividends: PagedList<HistoryDividendItem, { ticker?: string }>;

	/**
	 * Deposits, withdrawals, fees, transfers and interest.
	 *
	 * Scope `history:transactions` · 20 requests / minute.
	 */
	readonly transactions: PagedList<HistoryTransactionItem>;

	constructor(context: ResourceContext) {
		this.orders = new PagedList(context.transport, ENDPOINTS.listHistoricalOrders);
		this.dividends = new PagedList(context.transport, ENDPOINTS.listDividends);
		this.transactions = new PagedList(context.transport, ENDPOINTS.listTransactions);
	}
}
