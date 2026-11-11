import {
	isTrading212Error,
	NotFoundError,
	OrderOutcomeUnknownError,
	TimeoutError,
	type Trading212Error,
	TradingDisabledError,
	ValidationError,
} from "../errors/errors";
import type { EndpointDefinition } from "../http/endpoint";
import { ENDPOINTS, type EndpointId } from "../http/endpoints.generated";
import type { CallOptions } from "../http/transport";
import { durationOption } from "../internal/duration";
import { sleep } from "../internal/sleep";
import { truncateQuantity } from "../orders/quantity";
import { type OrderTimeValidity, type OrderType, validateOrder } from "../orders/validate";
import type { Page, PagedList } from "../pagination";
import type { HistoricalOrder, Order } from "../types/api.generated";

import type { ResourceContext } from "./context";
import type { PositionsResource } from "./positions";

export interface MarketOrderRequest {
	/** The Trading 212 ticker, such as `AAPL_US_EQ`. */
	ticker: string;
	/** Shares to trade, at most 4 decimal places. Positive buys, negative sells. */
	quantity: number;
	/** Allow the order to fill outside regular hours. Market orders only. */
	extendedHours?: boolean;
}

export interface LimitOrderRequest {
	ticker: string;
	quantity: number;
	/** Buys fill at this price or lower; sells at this price or higher. */
	limitPrice: number;
	timeValidity: OrderTimeValidity;
}

export interface StopOrderRequest {
	ticker: string;
	quantity: number;
	/** When the price reaches this, a market order is placed. */
	stopPrice: number;
	timeValidity: OrderTimeValidity;
}

export interface StopLimitOrderRequest {
	ticker: string;
	quantity: number;
	stopPrice: number;
	/** The limit order placed once `stopPrice` is reached. */
	limitPrice: number;
	timeValidity: OrderTimeValidity;
}

/** An order for `buy()` or `sell()`: the quantity is always positive and the method sets the direction. */
export type OrderInput =
	| ({ type?: "market" } & MarketOrderRequest)
	| ({ type: "limit" } & LimitOrderRequest)
	| ({ type: "stop" } & StopOrderRequest)
	| ({ type: "stopLimit" } & StopLimitOrderRequest);

export interface PlaceOptions extends CallOptions {
	/** Validate the order and return the request it would send, without sending it. */
	dryRun?: boolean;
}

/** What `dryRun` returns instead of an order. */
export interface DryRunResult {
	readonly dryRun: true;
	readonly method: "POST";
	readonly url: string;
	readonly endpoint: string;
	readonly body: Readonly<Record<string, unknown>>;
	/** False when trading is off for this client, so a real call would be refused before sending. */
	readonly wouldSend: boolean;
}

/** An `Order`, a `DryRunResult` for `{ dryRun: true }`, or either when `dryRun` is only known at run time. */
export type Placed<O extends PlaceOptions | undefined> = O extends { dryRun: true }
	? DryRunResult
	: O extends undefined
		? Order
		: "dryRun" extends keyof O
			? true extends NonNullable<O["dryRun"]>
				? Order | DryRunResult
				: Order
			: Order;

interface NoDryRun {
	dryRun?: false;
}

export interface WaitOptions extends CallOptions {
	/** Give up after this long. Default 60 s. */
	timeoutMs?: number;
	/** Time between checks. Default 1 s, the endpoint's limit. */
	intervalMs?: number;
}

export interface SellAllOptions extends PlaceOptions {
	extendedHours?: boolean;
}

export interface CancelAllOptions extends CallOptions {
	/** Only this ticker's orders. Default: every pending order. */
	ticker?: string;
}

/**
 * What happened to one order in `cancelAll()`. `requested`: Trading 212 accepted the cancellation, though the order
 * may still fill first. `gone`: it had already filled or been cancelled. `unknown`: the cancellation may or may not
 * have reached Trading 212. `failed`: it was refused, and `error` says why.
 */
export type CancelResult =
	| { readonly status: "requested"; readonly order: Order }
	| { readonly status: "gone"; readonly order: Order }
	| { readonly status: "unknown"; readonly order: Order; readonly error: OrderOutcomeUnknownError }
	| { readonly status: "failed"; readonly order: Order; readonly error: Trading212Error };

export interface FindAfterUnknownOptions extends CallOptions {
	/** How far either side of the moment it was sent an order may have been created and still match. Default 5 min. */
	windowMs?: number;
}

/**
 * What `findAfterUnknown()` found. `found`: the order reached Trading 212, so do not send it again; check its
 * `status`, as it may have been rejected. `not-found`: nothing like it is pending or in the history. `unclear`: several
 * orders match, or one is like it but differs in a detail, so it cannot say which, if any, is this one.
 */
export type OrderSearchResult =
	| { readonly status: "found"; readonly order: Order; readonly where: "pending" | "history" }
	| { readonly status: "not-found" }
	| { readonly status: "unclear"; readonly reason: string; readonly matches: readonly Order[] };

const ENDPOINT_FOR: Record<OrderType, EndpointDefinition> = {
	market: ENDPOINTS.placeMarketOrder,
	limit: ENDPOINTS.placeLimitOrder,
	stop: ENDPOINTS.placeStopOrder,
	stopLimit: ENDPOINTS.placeStopLimitOrder,
};

const PLACED_AS: Partial<Record<EndpointId, string>> = {
	placeMarketOrder: "MARKET",
	placeLimitOrder: "LIMIT",
	placeStopOrder: "STOP",
	placeStopLimitOrder: "STOP_LIMIT",
};

const MAX_HISTORY_PAGES = 4;

/** The statuses an order does not leave. */
export const FINAL_ORDER_STATUSES: ReadonlySet<string> = new Set(["FILLED", "CANCELLED", "REJECTED", "REPLACED"]);

function checkOrderId(id: unknown): number {
	if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
		throw new ValidationError("An order ID must be a positive whole number.", {
			issues: [{ field: "id", message: "is not a valid order ID" }],
		});
	}
	return id;
}

const tickerOf = (order: Order): string | undefined => order.ticker ?? order.instrument?.ticker ?? undefined;

/** A field that is missing on either side never rules an order out, so a match is never missed. */
const differs = (expected: unknown, actual: unknown): boolean =>
	typeof expected === "number" && typeof actual === "number" ? Math.abs(expected - actual) > 1e-9 : false;

interface SentOrder {
	readonly ticker: string;
	readonly quantity: number;
	readonly type: string;
	readonly limitPrice: unknown;
	readonly stopPrice: unknown;
	readonly sentAt: number;
}

function sentOrderOf(error: unknown): SentOrder {
	if (!(error instanceof OrderOutcomeUnknownError)) {
		throw new ValidationError("findAfterUnknown() takes the OrderOutcomeUnknownError an order threw.", {
			issues: [{ field: "error", message: "is not an OrderOutcomeUnknownError" }],
		});
	}
	const endpoint = error.request?.endpoint;
	const type = endpoint === undefined ? undefined : PLACED_AS[endpoint as EndpointId];
	const sent = (typeof error.sent === "object" && error.sent !== null ? error.sent : {}) as Record<string, unknown>;
	if (type === undefined || typeof sent.ticker !== "string" || typeof sent.quantity !== "number") {
		throw new ValidationError(
			`findAfterUnknown() looks for placed orders, and this error came from ${endpoint ?? "elsewhere"}.`,
			{
				issues: [{ field: "error", message: "is not from placing an order" }],
				hint: "For a cancellation, call orders.get(id): a NotFoundError means the order is no longer pending.",
			},
		);
	}
	return {
		ticker: sent.ticker,
		quantity: sent.quantity,
		type,
		limitPrice: sent.limitPrice,
		stopPrice: sent.stopPrice,
		sentAt: error.sentAt?.getTime() ?? Date.now(),
	};
}

/**
 * Whether a listed order is the one sent, one like it (same ticker, direction and time, but a detail differs), or
 * another order. A similar one makes the answer unclear rather than not found, because a detail Trading 212 lists
 * differently from what was sent must never make an order that went through look as if it did not.
 */
function resemblance(order: Order, sent: SentOrder, windowMs: number): "same" | "similar" | "other" {
	if (tickerOf(order) !== sent.ticker) return "other";
	if (order.side && order.side !== (sent.quantity > 0 ? "BUY" : "SELL")) return "other";
	const createdAt = order.createdAt ? Date.parse(order.createdAt) : Number.NaN;
	if (!Number.isNaN(createdAt) && Math.abs(createdAt - sent.sentAt) > windowMs) return "other";
	const listed = typeof order.quantity === "number" ? Math.abs(order.quantity) : undefined;
	const same =
		(!order.type || order.type === sent.type) &&
		(!order.initiatedFrom || order.initiatedFrom === "API") &&
		!differs(Math.abs(sent.quantity), listed) &&
		!differs(sent.limitPrice, order.limitPrice) &&
		!differs(sent.stopPrice, order.stopPrice);
	return same ? "same" : "similar";
}

interface Candidates {
	readonly same: Order[];
	readonly similar: Order[];
}

function sortInto(candidates: Candidates, orders: readonly Order[], sent: SentOrder, windowMs: number): void {
	for (const order of orders) {
		const seen =
			typeof order.id === "number" && [...candidates.same, ...candidates.similar].some(({ id }) => id === order.id);
		const kind = resemblance(order, sent, windowMs);
		if (!seen && kind !== "other") candidates[kind].push(order);
	}
}

function requestBody(input: object): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (key !== "type" && value !== undefined) body[key] = value;
	}
	return body;
}

export class OrdersResource {
	readonly #context: ResourceContext;
	readonly #positions: PositionsResource;
	readonly #history: PagedList<HistoricalOrder, { ticker?: string }>;

	constructor(
		context: ResourceContext,
		positions: PositionsResource,
		history: PagedList<HistoricalOrder, { ticker?: string }>,
	) {
		this.#context = context;
		this.#positions = positions;
		this.#history = history;
	}

	/**
	 * Orders that are still working: not yet filled, cancelled or expired.
	 *
	 * Scope `orders:read` · 1 request / 5 s.
	 */
	async list(options: CallOptions = {}): Promise<Order[]> {
		const { data } = await this.#context.transport.request<Order[] | undefined>(ENDPOINTS.listOrders, options);
		return Array.isArray(data) ? data : [];
	}

	/**
	 * One pending order. Throws `NotFoundError` once it has filled or been cancelled.
	 *
	 * Scope `orders:read` · 1 request / 1 s.
	 */
	async get(id: number, options: CallOptions = {}): Promise<Order> {
		const { data } = await this.#context.transport.request<Order>(ENDPOINTS.getOrder, {
			...options,
			params: { id: checkOrderId(id) },
		});
		return data;
	}

	/**
	 * Asks Trading 212 to cancel a pending order. Success means the request was accepted; the order may still fill
	 * first. Never retried.
	 *
	 * Scope `orders:execute` · 50 requests / minute.
	 */
	async cancel(id: number, options: CallOptions = {}): Promise<void> {
		await this.#context.transport.request(ENDPOINTS.cancelOrder, { ...options, params: { id: checkOrderId(id) } });
	}

	/**
	 * Trades at the next available price. A negative quantity sells. Never retried.
	 *
	 * Scope `orders:execute` · 50 requests / minute.
	 */
	async market<O extends PlaceOptions = NoDryRun>(request: MarketOrderRequest, options?: O): Promise<Placed<O>> {
		return this.#place("market", request, options);
	}

	/**
	 * Trades at `limitPrice` or better. A negative quantity sells. Never retried.
	 *
	 * Scope `orders:execute` · 1 request / 2 s.
	 */
	async limit<O extends PlaceOptions = NoDryRun>(request: LimitOrderRequest, options?: O): Promise<Placed<O>> {
		return this.#place("limit", request, options);
	}

	/**
	 * Places a market order once the price reaches `stopPrice`: a negative quantity makes a stop-loss. Never retried.
	 *
	 * Scope `orders:execute` · 1 request / 2 s.
	 */
	async stop<O extends PlaceOptions = NoDryRun>(request: StopOrderRequest, options?: O): Promise<Placed<O>> {
		return this.#place("stop", request, options);
	}

	/**
	 * Places a limit order at `limitPrice` once the price reaches `stopPrice`. Never retried.
	 *
	 * Scope `orders:execute` · 1 request / 2 s.
	 */
	async stopLimit<O extends PlaceOptions = NoDryRun>(request: StopLimitOrderRequest, options?: O): Promise<Placed<O>> {
		return this.#place("stopLimit", request, options);
	}

	/**
	 * Buys. The quantity is positive; `type` defaults to `market`.
	 *
	 * @example
	 * await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 0.5 });
	 * await t212.orders.buy({ type: "limit", ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 180, timeValidity: "DAY" });
	 */
	async buy<O extends PlaceOptions = NoDryRun>(input: OrderInput, options?: O): Promise<Placed<O>> {
		const { type = "market", ...fields } = input;
		validateOrder(type, fields, "positive");
		return this.#place(type, fields, options);
	}

	/**
	 * Sells. The quantity is positive and the sign is set for you, so a slip cannot turn a sale into a purchase.
	 *
	 * @example
	 * await t212.orders.sell({ type: "stop", ticker: "AAPL_US_EQ", quantity: 1, stopPrice: 150, timeValidity: "GOOD_TILL_CANCEL" });
	 */
	async sell<O extends PlaceOptions = NoDryRun>(input: OrderInput, options?: O): Promise<Placed<O>> {
		const { type = "market", ...fields } = input;
		validateOrder(type, fields, "positive");
		return this.#place(type, { ...fields, quantity: -fields.quantity }, options);
	}

	/**
	 * Sells everything you can of one holding at market: `quantityAvailableForTrading`, cut to 4 decimal places so it
	 * never exceeds what you own. Shares held in pies or reserved by pending orders are left alone.
	 */
	async sellAll<O extends SellAllOptions = NoDryRun>(ticker: string, options?: O): Promise<Placed<O>> {
		const { extendedHours, dryRun, ...call } = options ?? ({} as SellAllOptions);
		const position = await this.#positions.get(ticker, call);
		if (!position) {
			throw new ValidationError(`You hold no ${ticker}, so there is nothing to sell.`, {
				issues: [{ field: "ticker", message: "not held" }],
			});
		}
		const available = position.quantityAvailableForTrading;
		if (typeof available !== "number") {
			throw new ValidationError(`Trading 212 did not say how much of your ${ticker} is available to sell.`, {
				issues: [{ field: "quantityAvailableForTrading", message: "is missing from the position" }],
				hint: "Sell an explicit quantity with orders.sell() instead.",
			});
		}
		const quantity = truncateQuantity(available);
		if (quantity <= 0) {
			throw new ValidationError(`None of your ${ticker} is available to sell.`, {
				issues: [{ field: "quantity", message: `${available} available` }],
				hint: "Shares held in pies or reserved by pending orders cannot be sold until they are released.",
			});
		}
		const request: MarketOrderRequest = {
			ticker,
			quantity: -quantity,
			...(extendedHours !== undefined && { extendedHours }),
		};
		return this.#place("market", request, { ...call, ...(dryRun !== undefined && { dryRun }) } as O);
	}

	/**
	 * Waits until an order is filled, cancelled or rejected, and returns it in its final state. It polls the pending
	 * order, and once that is gone looks the order up in the history, so the key needs `history:orders` as well.
	 * `timeoutMs` bounds the whole wait, including any wait for rate-limit budget.
	 */
	async waitFor(order: Order | number, options: WaitOptions = {}): Promise<Order> {
		const { signal } = options;
		const timeoutMs = durationOption(options.timeoutMs, "timeoutMs") ?? 60_000;
		const intervalMs = durationOption(options.intervalMs, "intervalMs") ?? 1000;
		const id = checkOrderId(typeof order === "number" ? order : order.id);
		let ticker = typeof order === "number" ? undefined : (order.ticker ?? order.instrument?.ticker ?? undefined);
		let last = typeof order === "number" ? undefined : order;
		let gone = false;
		const deadline = Date.now() + timeoutMs;
		const expiry = AbortSignal.timeout(timeoutMs);
		const call = { signal: signal ? AbortSignal.any([signal, expiry]) : expiry };
		const timedOut = (): TimeoutError =>
			new TimeoutError(`Order ${id} had not settled after ${timeoutMs} ms (last seen ${last?.status ?? "pending"}).`, {
				hint: "It may still fill. Check it again with orders.get() or history.orders.list().",
			});
		try {
			for (;;) {
				if (!gone) {
					try {
						const { data: current } = await this.#context.transport.request<Order>(ENDPOINTS.getOrder, {
							...call,
							params: { id },
							expectNotFound: true,
						});
						last = current;
						ticker ??= current.ticker ?? current.instrument?.ticker ?? undefined;
						if (current.status && FINAL_ORDER_STATUSES.has(current.status)) return current;
					} catch (error) {
						if (!(error instanceof NotFoundError)) throw error;
						// A pending order that has gone never comes back, so from here only the history is asked.
						gone = true;
					}
				}
				if (gone) {
					const settled = await this.#fromHistory(id, ticker, call);
					if (settled) return settled;
				}
				if (Date.now() + intervalMs > deadline) throw timedOut();
				await sleep(intervalMs, call.signal);
			}
		} catch (error) {
			if (expiry.aborted && !signal?.aborted) throw timedOut();
			throw error;
		}
	}

	/**
	 * Asks Trading 212 to cancel every pending order, or one ticker's, one request each and never retried. An order
	 * that has already gone counts as done, and a failure is reported in its result rather than stopping the rest.
	 * Aborting the signal stops it before the next order, and throws.
	 *
	 * Scope `orders:read` and `orders:execute`.
	 *
	 * @example
	 * const results = await t212.orders.cancelAll({ ticker: "AAPL_US_EQ" });
	 * const failed = results.filter((result) => result.status === "failed");
	 */
	async cancelAll(options: CancelAllOptions = {}): Promise<CancelResult[]> {
		const { ticker, ...call } = options;
		const pending = (await this.list(call)).filter((order) => ticker === undefined || tickerOf(order) === ticker);
		const results: CancelResult[] = [];
		for (const order of pending) {
			try {
				await this.#context.transport.request(ENDPOINTS.cancelOrder, {
					...call,
					params: { id: checkOrderId(order.id) },
					expectNotFound: true,
				});
				results.push({ status: "requested", order });
			} catch (error) {
				if (error instanceof TradingDisabledError || !isTrading212Error(error)) throw error;
				if (error instanceof NotFoundError) results.push({ status: "gone", order });
				else if (error instanceof OrderOutcomeUnknownError) results.push({ status: "unknown", order, error });
				else results.push({ status: "failed", order, error });
			}
		}
		return results;
	}

	/**
	 * After an order threw `OrderOutcomeUnknownError`, looks for it among the pending orders and the recent history,
	 * matching the ticker, direction, type, quantity and prices of what was sent. It never sends anything, so whether
	 * to place the order again stays your decision. Trading 212 may take a moment to list a new order, so give it a
	 * few seconds before deciding it was not placed.
	 *
	 * Scope `orders:read` and `history:orders`.
	 *
	 * @example
	 * await new Promise((resolve) => setTimeout(resolve, 5000));
	 * const result = await t212.orders.findAfterUnknown(error);
	 * if (result.status === "not-found") await t212.orders.buy(request);
	 */
	async findAfterUnknown(error: unknown, options: FindAfterUnknownOptions = {}): Promise<OrderSearchResult> {
		const { windowMs: given, ...call } = options;
		const sent = sentOrderOf(error);
		const windowMs = durationOption(given, "windowMs") ?? 5 * 60_000;
		const candidates: Candidates = { same: [], similar: [] };
		const pending = await this.list(call);
		sortInto(candidates, pending, sent, windowMs);
		const searched = await this.#searchHistory(candidates, sent, windowMs, call);
		const { same, similar } = candidates;
		const [only] = same;
		if (!searched) {
			return {
				status: "unclear",
				reason: "the history holds too many recent orders to search",
				matches: [...same, ...similar],
			};
		}
		if (same.length === 1 && only) {
			return { status: "found", order: only, where: pending.includes(only) ? "pending" : "history" };
		}
		if (same.length > 1) return { status: "unclear", reason: `${same.length} recent orders match it`, matches: same };
		if (similar.length > 0) {
			return {
				status: "unclear",
				reason: `${similar.length} recent ${similar.length === 1 ? "order is" : "orders are"} like it, but not the same`,
				matches: similar,
			};
		}
		return { status: "not-found" };
	}

	/** Sorts the recent history into the candidates; false when the window reaches past the pages it may read. */
	async #searchHistory(candidates: Candidates, sent: SentOrder, windowMs: number, call: CallOptions): Promise<boolean> {
		let page: Page<HistoricalOrder> | null = await this.#history.list({ ...call, limit: 50, ticker: sent.ticker });
		for (let read = 1; page; read++) {
			sortInto(
				candidates,
				page.items.flatMap(({ order }) => order ?? []),
				sent,
				windowMs,
			);
			const oldest = page.items.at(-1)?.order?.createdAt;
			const pastWindow = oldest !== undefined && oldest !== null && Date.parse(oldest) < sent.sentAt - windowMs;
			if (!page.hasMore || pastWindow) return true;
			if (read === MAX_HISTORY_PAGES) return false;
			page = await page.next(call);
		}
		return true;
	}

	async #fromHistory(id: number, ticker: string | undefined, call: CallOptions): Promise<Order | undefined> {
		const page = await this.#history.list({ ...call, limit: 50, ...(ticker && { ticker }) });
		return page.items.find((item) => item.order?.id === id)?.order ?? undefined;
	}

	async #place<O extends PlaceOptions>(type: OrderType, request: object, options: O | undefined): Promise<Placed<O>> {
		const { dryRun = false, ...call } = options ?? ({} as PlaceOptions);
		const body = requestBody(request);
		validateOrder(type, body);
		this.#checkMaxOpenQuantity(body);
		const endpoint = ENDPOINT_FOR[type];
		const { transport } = this.#context;
		if (dryRun) {
			const { url } = transport.describe(endpoint);
			const result: DryRunResult = {
				dryRun: true,
				method: "POST",
				url,
				endpoint: endpoint.id,
				body,
				wouldSend: transport.tradingEnabled,
			};
			return result as Placed<O>;
		}
		const { data } = await transport.request<Order>(endpoint, { ...call, body, expectBody: true });
		return data as Placed<O>;
	}

	/**
	 * Refuses an order larger than the instrument's `maxOpenQuantity`, once this client has loaded the instrument list;
	 * it is never downloaded for this. The spec does not define the field, so it is read as the most of an instrument an
	 * account may hold, which no single order can exceed.
	 */
	#checkMaxOpenQuantity(body: Record<string, unknown>): void {
		const max = this.#context.maxOpenQuantities.get(String(body.ticker));
		const quantity = Math.abs(body.quantity as number);
		if (max === undefined || quantity <= max) return;
		throw new ValidationError(
			`The order is for ${quantity} ${String(body.ticker)}, more than the ${max} Trading 212 lets an account hold.`,
			{
				issues: [{ field: "quantity", message: `is more than the maxOpenQuantity of ${max}` }],
				hint: "Nothing was sent. If Trading 212 has raised the limit since the instrument list was cached, refresh it with instruments.list({ refresh: true }).",
			},
		);
	}
}
