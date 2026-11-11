import { ValidationError } from "../errors/errors";
import { ENDPOINTS } from "../http/endpoints.generated";
import type { CallOptions } from "../http/transport";
import { PagedList } from "../pagination";
import type { HistoricalOrder, HistoryDividendItem, HistoryTransactionItem } from "../types/api.generated";

import type { ResourceContext } from "./context";

export interface DividendTotalOptions extends CallOptions {
	/** Only dividends paid at or after this moment. */
	since?: Date | string;
	/** Only dividends paid before this moment. */
	until?: Date | string;
	/** Only this ticker's dividends. */
	ticker?: string;
}

/** Dividends added up, in the account's currency. */
export interface DividendTotals {
	readonly total: number;
	/** How many payments were counted. */
	readonly count: number;
	/** The account's currency, as Trading 212 gave it on the payments. */
	readonly currency: string | undefined;
	/** Each ticker's total, largest first. */
	readonly byTicker: Readonly<Record<string, number>>;
}

// Sums of amounts such as 0.1 and 0.2 carry binary noise; eight places keeps every real digit.
const tidy = (value: number): number => Math.round(value * 1e8) / 1e8;

function instant(value: Date | string | undefined, field: string): number | undefined {
	if (value === undefined) return undefined;
	const time = value instanceof Date ? value.getTime() : Date.parse(value);
	if (Number.isNaN(time)) {
		throw new ValidationError(`${field} is not a valid date.`, { issues: [{ field, message: "is not a valid date" }] });
	}
	return time;
}

/** Dividends paid out, a page at a time or added up. */
export class DividendList extends PagedList<HistoryDividendItem, { ticker?: string }> {
	/**
	 * Adds up the dividends paid between `since` and `until`, in total and per ticker. It reads every page, because the
	 * spec does not say the history is sorted, so stopping early could leave a payment out.
	 *
	 * @example
	 * const { total, byTicker } = await t212.history.dividends.total({ since: "2026-04-06" });
	 */
	async total(options: DividendTotalOptions = {}): Promise<DividendTotals> {
		const { since, until, ticker, ...call } = options;
		const from = instant(since, "since");
		const to = instant(until, "until");
		const byTicker = new Map<string, number>();
		let total = 0;
		let count = 0;
		let currency: string | undefined;
		for await (const dividend of this.all({ ...call, ...(ticker !== undefined && { ticker }) })) {
			const paidOn = dividend.paidOn ? Date.parse(dividend.paidOn) : Number.NaN;
			if (from !== undefined && !(paidOn >= from)) continue;
			if (to !== undefined && !(paidOn < to)) continue;
			const amount = dividend.amount ?? 0;
			const key = dividend.ticker ?? "unknown";
			byTicker.set(key, tidy((byTicker.get(key) ?? 0) + amount));
			total = tidy(total + amount);
			count++;
			currency ??= dividend.currency ?? undefined;
		}
		const sorted = [...byTicker].sort(([, a], [, b]) => b - a);
		return { total, count, currency, byTicker: Object.fromEntries(sorted) };
	}
}

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
	 * Dividends paid out, and `total()` to add them up.
	 *
	 * Scope `history:dividends` · 20 requests / minute.
	 */
	readonly dividends: DividendList;

	/**
	 * Deposits, withdrawals, fees, transfers and interest. `time` starts the list from that moment.
	 *
	 * Scope `history:transactions` · 20 requests / minute.
	 */
	readonly transactions: PagedList<HistoryTransactionItem, { time?: Date | string }>;

	constructor(context: ResourceContext) {
		this.orders = new PagedList(context.transport, ENDPOINTS.listHistoricalOrders);
		this.dividends = new DividendList(context.transport, ENDPOINTS.listDividends);
		this.transactions = new PagedList(context.transport, ENDPOINTS.listTransactions);
	}
}
