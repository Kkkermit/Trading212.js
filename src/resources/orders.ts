import { NotFoundError, TimeoutError, ValidationError } from "../errors/errors";
import type { EndpointDefinition } from "../http/endpoint";
import { ENDPOINTS } from "../http/endpoints.generated";
import type { CallOptions } from "../http/transport";
import { sleep } from "../internal/sleep";
import { truncateQuantity } from "../orders/quantity";
import { type OrderTimeValidity, type OrderType, validateOrder } from "../orders/validate";
import type { PagedList } from "../pagination";
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
	/** False when this client would refuse to send it: a live client without `trading: "enabled"`. */
	readonly wouldSend: boolean;
}

export type Placed<O extends PlaceOptions | undefined> = O extends { dryRun: true } ? DryRunResult : Order;

export interface WaitOptions extends CallOptions {
	/** Give up after this long. Default 60 s. */
	timeoutMs?: number;
	/** Time between checks. Default 1 s, the endpoint's limit. */
	intervalMs?: number;
}

export interface SellAllOptions extends PlaceOptions {
	extendedHours?: boolean;
}

const ENDPOINT_FOR: Record<OrderType, EndpointDefinition> = {
	market: ENDPOINTS.placeMarketOrder,
	limit: ENDPOINTS.placeLimitOrder,
	stop: ENDPOINTS.placeStopOrder,
	stopLimit: ENDPOINTS.placeStopLimitOrder,
};

/** The statuses an order does not leave. */
export const FINAL_ORDER_STATUSES: ReadonlySet<string> = new Set(["FILLED", "CANCELLED", "REJECTED", "REPLACED"]);

function checkId(id: unknown): number {
	if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
		throw new ValidationError("An order ID must be a positive whole number.", {
			issues: [{ field: "id", message: "is not a valid order ID" }],
		});
	}
	return id;
}

function bodyOf(input: object): Record<string, unknown> {
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
			params: { id: checkId(id) },
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
		await this.#context.transport.request(ENDPOINTS.cancelOrder, { ...options, params: { id: checkId(id) } });
	}

	/**
	 * Trades at the next available price. A negative quantity sells. Never retried.
	 *
	 * Scope `orders:execute` · 50 requests / minute.
	 */
	async market<O extends PlaceOptions>(request: MarketOrderRequest, options?: O): Promise<Placed<O>> {
		return this.#place("market", request, options);
	}

	/**
	 * Trades at `limitPrice` or better. A negative quantity sells. Never retried.
	 *
	 * Scope `orders:execute` · 1 request / 2 s.
	 */
	async limit<O extends PlaceOptions>(request: LimitOrderRequest, options?: O): Promise<Placed<O>> {
		return this.#place("limit", request, options);
	}

	/**
	 * Places a market order once the price reaches `stopPrice`: a negative quantity makes a stop-loss. Never retried.
	 *
	 * Scope `orders:execute` · 1 request / 2 s.
	 */
	async stop<O extends PlaceOptions>(request: StopOrderRequest, options?: O): Promise<Placed<O>> {
		return this.#place("stop", request, options);
	}

	/**
	 * Places a limit order at `limitPrice` once the price reaches `stopPrice`. Never retried.
	 *
	 * Scope `orders:execute` · 1 request / 2 s.
	 */
	async stopLimit<O extends PlaceOptions>(request: StopLimitOrderRequest, options?: O): Promise<Placed<O>> {
		return this.#place("stopLimit", request, options);
	}

	/**
	 * Buys. The quantity is positive; `type` defaults to `market`.
	 *
	 * @example
	 * await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 0.5 });
	 * await t212.orders.buy({ type: "limit", ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 180, timeValidity: "DAY" });
	 */
	async buy<O extends PlaceOptions>(input: OrderInput, options?: O): Promise<Placed<O>> {
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
	async sell<O extends PlaceOptions>(input: OrderInput, options?: O): Promise<Placed<O>> {
		const { type = "market", ...fields } = input;
		validateOrder(type, fields, "positive");
		return this.#place(type, { ...fields, quantity: -fields.quantity }, options);
	}

	/**
	 * Sells everything you can of one holding at market: `quantityAvailableForTrading`, cut to 4 decimal places so it
	 * never exceeds what you own. Shares held in pies or reserved by pending orders are left alone.
	 */
	async sellAll<O extends SellAllOptions>(ticker: string, options?: O): Promise<Placed<O>> {
		const { extendedHours, dryRun, ...call } = options ?? ({} as SellAllOptions);
		const position = await this.#positions.get(ticker, call);
		if (!position) {
			throw new ValidationError(`You hold no ${ticker}, so there is nothing to sell.`, {
				issues: [{ field: "ticker", message: "not held" }],
			});
		}
		const available = position.quantityAvailableForTrading ?? position.quantity ?? 0;
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
	 * order, and once that is gone looks the order up in the history.
	 */
	async waitFor(order: Order | number, options: WaitOptions = {}): Promise<Order> {
		const { timeoutMs = 60_000, intervalMs = 1000, signal } = options;
		const id = checkId(typeof order === "number" ? order : order.id);
		let ticker = typeof order === "number" ? undefined : (order.ticker ?? order.instrument?.ticker ?? undefined);
		let last = typeof order === "number" ? undefined : order;
		const deadline = Date.now() + timeoutMs;
		const call = signal ? { signal } : {};
		for (;;) {
			try {
				const current = await this.get(id, call);
				last = current;
				ticker ??= current.ticker ?? current.instrument?.ticker ?? undefined;
				if (current.status && FINAL_ORDER_STATUSES.has(current.status)) return current;
			} catch (error) {
				if (!(error instanceof NotFoundError)) throw error;
				const settled = await this.#fromHistory(id, ticker, call);
				if (settled) return settled;
			}
			if (Date.now() + intervalMs > deadline) {
				throw new TimeoutError(
					`Order ${id} had not settled after ${timeoutMs} ms (last seen ${last?.status ?? "pending"}).`,
					{
						hint: "It may still fill. Check it again with orders.get() or history.orders.list().",
					},
				);
			}
			await sleep(intervalMs, signal);
		}
	}

	async #fromHistory(id: number, ticker: string | undefined, call: CallOptions): Promise<Order | undefined> {
		const page = await this.#history.list({ ...call, limit: 50, ...(ticker && { ticker }) });
		return page.items.find((item) => item.order?.id === id)?.order ?? undefined;
	}

	async #place<O extends PlaceOptions>(type: OrderType, request: object, options: O | undefined): Promise<Placed<O>> {
		const { dryRun = false, ...call } = options ?? ({} as PlaceOptions);
		const body = bodyOf(request);
		validateOrder(type, body);
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
		const { data } = await transport.request<Order>(endpoint, { ...call, body });
		return data as Placed<O>;
	}
}
