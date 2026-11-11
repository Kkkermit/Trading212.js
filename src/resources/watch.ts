import { durationOption } from "../internal/duration";
import type { Logger } from "../logging/logger";
import type { PagedList } from "../pagination";
import type { AccountSummary, Cash, Fill, HistoricalOrder, Order, Position } from "../types/api.generated";
import { Watcher } from "../watcher";

import type { AccountResource } from "./account";
import type { OrdersResource } from "./orders";
import type { PositionsResource } from "./positions";

export interface WatchOptions {
	/** Time between checks. Default 5 s; the client paces anything faster to the endpoint's rate limit. */
	intervalMs?: number;
	/** Stops the watcher when it aborts. */
	signal?: AbortSignal;
}

/** How an order ended, from Trading 212's history, with its fill when it has one. */
export interface SettledOrderEvent {
	readonly type: "filled" | "cancelled" | "rejected" | "replaced";
	readonly order: Order;
	readonly fill: Fill | undefined;
}

export type OrderEvent =
	/** A new pending order. An order that fills at once, as market orders usually do, is only reported as `filled`. */
	| { readonly type: "placed"; readonly order: Order }
	/** A pending order's status, filled quantity or prices changed. */
	| { readonly type: "updated"; readonly order: Order; readonly previous: Order }
	| SettledOrderEvent
	/** An order left the pending list, and the history never showed how it ended. */
	| { readonly type: "gone"; readonly order: Order };

export type PositionEvent =
	| { readonly type: "opened"; readonly position: Position }
	/** The quantity held changed. Price moves alone are not reported. */
	| { readonly type: "changed"; readonly position: Position; readonly previous: Position }
	/** The position no longer exists; `position` is how it last looked. */
	| { readonly type: "closed"; readonly position: Position };

export interface CashEvent {
	/** Cash available to trade, reserved for orders, or held in pies changed. */
	readonly type: "changed";
	readonly cash: Cash;
	readonly previous: Cash;
	readonly summary: AccountSummary;
}

const SETTLED: Readonly<Record<string, SettledOrderEvent["type"]>> = {
	FILLED: "filled",
	CANCELLED: "cancelled",
	REJECTED: "rejected",
	REPLACED: "replaced",
};

// Checks an order that left the pending list gets before it is reported as gone.
const LOOKUPS_BEFORE_GONE = 5;
// Settled orders remembered so none is reported twice; the oldest are forgotten first.
const REMEMBERED = 1000;

const differs = (a: number | null | undefined, b: number | null | undefined): boolean =>
	Math.abs((a ?? 0) - (b ?? 0)) > 1e-9;

const settledType = (order: Order | null | undefined): SettledOrderEvent["type"] | undefined =>
	order?.status ? SETTLED[order.status] : undefined;

function ordersById(orders: readonly Order[]): Map<number, Order> {
	const byId = new Map<number, Order>();
	for (const order of orders) if (typeof order.id === "number") byId.set(order.id, order);
	return byId;
}

class RecentIds {
	readonly #ids = new Set<number>();

	has(id: number): boolean {
		return this.#ids.has(id);
	}

	add(id: number): void {
		this.#ids.add(id);
		const [oldest] = this.#ids;
		if (this.#ids.size > REMEMBERED && oldest !== undefined) this.#ids.delete(oldest);
	}
}

/** Tracks the pending orders and recent history between checks, and works out what happened. */
class OrderTracker {
	#pending: Map<number, Order> | undefined;
	readonly #settled = new RecentIds();
	readonly #missing = new Map<number, { order: Order; lookups: number }>();
	readonly #orders: OrdersResource;
	readonly #history: PagedList<HistoricalOrder, { ticker?: string }>;

	constructor(orders: OrdersResource, history: PagedList<HistoricalOrder, { ticker?: string }>) {
		this.#orders = orders;
		this.#history = history;
	}

	readonly poll = async (signal: AbortSignal): Promise<OrderEvent[]> => {
		// Orders never seen pending are found here only if the history is newest first, which the spec does not state.
		const [orders, page] = await Promise.all([
			this.#orders.list({ signal }),
			this.#history.list({ signal, limit: 50 }),
		]);
		const current = ordersById(orders);
		const previous = this.#pending;
		if (previous === undefined) {
			for (const { order } of page.items)
				if (typeof order?.id === "number" && settledType(order)) this.#settled.add(order.id);
			for (const [id, order] of current) if (settledType(order)) this.#settled.add(id);
			this.#pending = current;
			return [];
		}
		const left = new Map(this.#missing);
		for (const [id, order] of previous) {
			if (!current.has(id) && !this.#settled.has(id) && !left.has(id)) left.set(id, { order, lookups: 0 });
		}
		const settled = new Map<number, HistoricalOrder>();
		for (const item of page.items) {
			const id = item.order?.id;
			if (typeof id === "number" && settledType(item.order)) settled.set(id, item);
		}
		// Reads come before any state changes, so a failed check loses nothing and the next one starts afresh.
		const tickers = new Set<string>();
		for (const [id, { order }] of left) {
			const ticker = order.ticker ?? order.instrument?.ticker;
			if (!settled.has(id) && ticker) tickers.add(ticker);
		}
		for (const ticker of tickers) {
			const found = await this.#history.list({ signal, limit: 50, ticker });
			for (const item of found.items) {
				const id = item.order?.id;
				if (typeof id === "number" && left.has(id) && settledType(item.order)) settled.set(id, item);
			}
		}

		const events: OrderEvent[] = [];
		for (const [id, item] of settled) {
			const type = settledType(item.order);
			if (this.#settled.has(id) || !type || !item.order) continue;
			this.#settled.add(id);
			events.push({ type, order: item.order, fill: item.fill ?? undefined });
		}
		for (const [id, order] of current) {
			if (this.#settled.has(id)) continue;
			const type = settledType(order);
			// An order missing from one check and back in the next is the same order, not a new one.
			const before = previous.get(id) ?? left.get(id)?.order;
			if (type) {
				this.#settled.add(id);
				events.push({ type, order, fill: undefined });
			} else if (!before) events.push({ type: "placed", order });
			else if (
				before.status !== order.status ||
				differs(before.filledQuantity, order.filledQuantity) ||
				differs(before.quantity, order.quantity) ||
				differs(before.limitPrice, order.limitPrice) ||
				differs(before.stopPrice, order.stopPrice)
			) {
				events.push({ type: "updated", order, previous: before });
			}
		}
		this.#missing.clear();
		for (const [id, entry] of left) {
			if (this.#settled.has(id) || current.has(id)) continue;
			const lookups = entry.lookups + 1;
			if (lookups < LOOKUPS_BEFORE_GONE) {
				this.#missing.set(id, { order: entry.order, lookups });
				continue;
			}
			this.#settled.add(id);
			events.push({ type: "gone", order: entry.order });
		}
		this.#pending = current;
		return events;
	};
}

function positionTracker(positions: PositionsResource): (signal: AbortSignal) => Promise<PositionEvent[]> {
	let previous: Map<string, Position> | undefined;
	return async (signal) => {
		const current = new Map<string, Position>();
		for (const position of await positions.list({ signal })) {
			const ticker = position.instrument?.ticker;
			if (ticker) current.set(ticker, position);
		}
		const before = previous;
		previous = current;
		if (before === undefined) return [];
		const events: PositionEvent[] = [];
		for (const [ticker, position] of current) {
			const last = before.get(ticker);
			if (!last) events.push({ type: "opened", position });
			else if (differs(last.quantity, position.quantity)) events.push({ type: "changed", position, previous: last });
		}
		for (const [ticker, position] of before) if (!current.has(ticker)) events.push({ type: "closed", position });
		return events;
	};
}

function cashTracker(account: AccountResource): (signal: AbortSignal) => Promise<CashEvent[]> {
	let previous: Cash | undefined;
	return async (signal) => {
		const summary = await account.summary({ signal });
		const cash = summary.cash ?? {};
		const before = previous;
		previous = cash;
		if (
			before === undefined ||
			!(
				differs(before.availableToTrade, cash.availableToTrade) ||
				differs(before.reservedForOrders, cash.reservedForOrders) ||
				differs(before.inPies, cash.inPies)
			)
		) {
			return [];
		}
		return [{ type: "changed", cash, previous: before, summary }];
	};
}

/**
 * Watchers that check the account at an interval and report what changed. Trading 212's API has no push updates,
 * so each check is a request. The first check only records where things stand; events start from the second.
 */
export class WatchResource {
	readonly #account: AccountResource;
	readonly #positions: PositionsResource;
	readonly #orders: OrdersResource;
	readonly #history: PagedList<HistoricalOrder, { ticker?: string }>;
	readonly #logger: Logger;

	constructor(
		account: AccountResource,
		positions: PositionsResource,
		orders: OrdersResource,
		history: PagedList<HistoricalOrder, { ticker?: string }>,
		logger: Logger,
	) {
		this.#account = account;
		this.#positions = positions;
		this.#orders = orders;
		this.#history = history;
		this.#logger = logger;
	}

	/**
	 * Reports orders being placed, updated, filled, cancelled or rejected, including ones placed elsewhere, such as in
	 * the app. Each check reads the pending orders and the newest page of the history.
	 *
	 * Scope `orders:read` and `history:orders`.
	 *
	 * @example
	 * const watcher = t212.watch.orders();
	 * watcher.on("filled", ({ order, fill }) => console.log(`${order.ticker} filled at ${fill?.price}`));
	 */
	orders(options: WatchOptions = {}): Watcher<OrderEvent> {
		return this.#start(new OrderTracker(this.#orders, this.#history).poll, options);
	}

	/**
	 * Reports positions being opened, changing size, or closed.
	 *
	 * Scope `portfolio`.
	 *
	 * @example
	 * t212.watch.positions().on("opened", ({ position }) => console.log(`Bought into ${position.instrument?.ticker}`));
	 */
	positions(options: WatchOptions = {}): Watcher<PositionEvent> {
		return this.#start(positionTracker(this.#positions), options);
	}

	/**
	 * Reports the account's cash changing: deposits, withdrawals, fills, dividends and cash reserved for orders.
	 *
	 * Scope `account`.
	 *
	 * @example
	 * t212.watch.cash().on("changed", ({ cash, previous }) => console.log(previous.availableToTrade, "->", cash.availableToTrade));
	 */
	cash(options: WatchOptions = {}): Watcher<CashEvent> {
		return this.#start(cashTracker(this.#account), options);
	}

	#start<E extends { readonly type: string }>(
		poll: (signal: AbortSignal) => Promise<E[]>,
		options: WatchOptions,
	): Watcher<E> {
		const intervalMs = durationOption(options.intervalMs, "intervalMs") ?? 5000;
		return new Watcher(poll, { intervalMs, signal: options.signal, logger: this.#logger });
	}
}
