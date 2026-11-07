import { BASE_URLS, type Environment } from "../environment";
import type { EndpointDefinition } from "../http/endpoint";
import { ENDPOINTS, type EndpointId } from "../http/endpoints.generated";
import type { FetchLike } from "../http/transport";
import { decimalPlaces } from "../orders/quantity";
import type {
	AccountBucketInstrumentsDetailedResponse,
	AccountBucketResultResponse,
	Exchange,
	HistoricalOrder,
	HistoryDividendItem,
	HistoryTransactionItem,
	Order,
	PieRequest,
	Position,
	ReportResponse,
	TradableInstrument,
} from "../types/api.generated";

import { networkError, type RecordedRequest, recordRequest, type ScriptedResponse, toResponse } from "./scriptedFetch";

export const FAKE_API_KEY = "fake-trading212-key";
export const FAKE_API_SECRET = "fake-trading212-secret";
const FAKE_AUTHORIZATION = `Basic ${btoa(`${FAKE_API_KEY}:${FAKE_API_SECRET}`)}`;
const REPORT_HOST = "https://reports.fake-trading212.invalid";

export interface FakeHolding {
	ticker: string;
	quantity: number;
	/** Average price paid per share. Defaults to the current price. */
	averagePrice?: number;
	/** Shares held in pies, which cannot be sold directly. */
	inPies?: number;
}

/** The account the fake starts with. Everything is optional. */
export interface FakeAccountState {
	accountId?: number;
	/** Default `GBP`. Prices are treated as already in this currency; the fake does no FX. */
	currency?: string;
	/** Free cash. Default 10,000. */
	cash?: number;
	/** Default: Apple, Microsoft and Tesla on US markets, and Vanguard's S&P 500 ETF in London. */
	instruments?: TradableInstrument[];
	/** Price per ticker. Unlisted tickers default to 100. */
	prices?: Record<string, number>;
	positions?: FakeHolding[];
	dividends?: HistoryDividendItem[];
	transactions?: HistoryTransactionItem[];
	exchanges?: Exchange[];
}

/** A failure to inject: an HTTP response, or a network failure with Node's error code. */
export type FakeFailure = ScriptedResponse | { network: string };

export const DEFAULT_INSTRUMENTS: readonly TradableInstrument[] = [
	{
		ticker: "AAPL_US_EQ",
		name: "Apple",
		shortName: "AAPL",
		isin: "US0378331005",
		currencyCode: "USD",
		type: "STOCK",
		workingScheduleId: 1,
		extendedHours: true,
		maxOpenQuantity: 10_000,
		addedOn: "2018-07-12T08:00:00.000Z",
	},
	{
		ticker: "MSFT_US_EQ",
		name: "Microsoft",
		shortName: "MSFT",
		isin: "US5949181045",
		currencyCode: "USD",
		type: "STOCK",
		workingScheduleId: 1,
		extendedHours: true,
		maxOpenQuantity: 10_000,
		addedOn: "2018-07-12T08:00:00.000Z",
	},
	{
		ticker: "TSLA_US_EQ",
		name: "Tesla",
		shortName: "TSLA",
		isin: "US88160R1014",
		currencyCode: "USD",
		type: "STOCK",
		workingScheduleId: 1,
		extendedHours: true,
		maxOpenQuantity: 10_000,
		addedOn: "2018-07-12T08:00:00.000Z",
	},
	{
		ticker: "VUSAl_EQ",
		name: "Vanguard S&P 500 UCITS ETF",
		shortName: "VUSA",
		isin: "IE00B3XXRP09",
		currencyCode: "GBP",
		type: "ETF",
		workingScheduleId: 2,
		extendedHours: false,
		maxOpenQuantity: 10_000,
		addedOn: "2019-02-01T08:00:00.000Z",
	},
];

const DEFAULT_PRICES: Readonly<Record<string, number>> = {
	AAPL_US_EQ: 230,
	MSFT_US_EQ: 420,
	TSLA_US_EQ: 250,
	VUSAl_EQ: 95,
};

/** A week of weekday sessions from the start of `from`'s day, in UTC. */
export function weekOfSessions(from: Date, openUtc: string, closeUtc: string): { date: string; type: string }[] {
	const events: { date: string; type: string }[] = [];
	const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
	for (let offset = -1; offset < 8; offset++) {
		const date = new Date(day.getTime() + offset * 86_400_000);
		const weekday = date.getUTCDay();
		if (weekday === 0 || weekday === 6) continue;
		const stamp = date.toISOString().slice(0, 10);
		events.push(
			{ date: `${stamp}T${openUtc}:00.000Z`, type: "OPEN" },
			{ date: `${stamp}T${closeUtc}:00.000Z`, type: "CLOSE" },
		);
	}
	return events;
}

function defaultExchanges(now: Date): Exchange[] {
	return [
		{ id: 1, name: "NASDAQ", workingSchedules: [{ id: 1, timeEvents: weekOfSessions(now, "14:30", "21:00") }] },
		{
			id: 2,
			name: "London Stock Exchange",
			workingSchedules: [{ id: 2, timeEvents: weekOfSessions(now, "08:00", "16:30") }],
		},
	];
}

const MONEY = (value: number): number => Math.round(value * 100) / 100;
const SHARES = (value: number): number => Math.round(value * 1e8) / 1e8;

/** A holding as the fake keeps it. */
export interface FakeHoldingState {
	ticker: string;
	quantity: number;
	averagePrice: number;
	inPies: number;
	createdAt: string;
}

/** A pending order and what it has reserved. */
export interface FakePendingOrder {
	order: Order;
	reservedCash: number;
	reservedShares: number;
}

function problem(status: number, code: string, detail: string): ScriptedResponse {
	return { status, body: { type: `/api-errors/${code}`, title: detail, status, detail } };
}

function legacy(status: number, code: string, clarification: string): ScriptedResponse {
	return { status, body: { code, clarification } };
}

/**
 * An in-memory Trading 212 that the real client talks to through `fetch`, so your code runs exactly as it would
 * against the API: validation, errors, pagination and all. Market orders fill at once at the current price; limit
 * and stop orders wait until you call `fill()`.
 */
export class FakeTrading212Server {
	readonly environment: Environment;
	/** Every request the client made, without credentials. */
	readonly requests: RecordedRequest[] = [];
	/** When false, every order is refused with `MarketClosed`. */
	marketOpen = true;
	/** Trading 212 refuses CSV exports on demo; set this to let the fake offer them anyway. */
	exportsOnDemo = false;

	cash: number;
	readonly currency: string;
	readonly accountId: number;
	readonly instruments: TradableInstrument[];
	readonly prices: Map<string, number>;
	readonly holdings = new Map<string, FakeHoldingState>();
	readonly pending = new Map<number, FakePendingOrder>();
	readonly orderHistory: HistoricalOrder[] = [];
	readonly dividends: HistoryDividendItem[];
	readonly transactions: HistoryTransactionItem[];
	readonly exchanges: Exchange[];
	readonly reports: ReportResponse[] = [];
	readonly pies = new Map<number, { settings: PieRequest; cash: number }>();
	realisedProfitLoss = 0;

	readonly #failures = new Map<EndpointId, FakeFailure[]>();
	readonly #origin: string;
	#nextId = 1_000_000;

	constructor(state: FakeAccountState = {}, environment: Environment = "demo") {
		this.environment = environment;
		this.#origin = BASE_URLS[environment];
		this.cash = state.cash ?? 10_000;
		this.currency = state.currency ?? "GBP";
		this.accountId = state.accountId ?? 12_345_678;
		this.instruments = (state.instruments ?? DEFAULT_INSTRUMENTS).map((instrument) => ({ ...instrument }));
		this.prices = new Map(Object.entries({ ...DEFAULT_PRICES, ...state.prices }));
		this.dividends = [...(state.dividends ?? [])];
		this.transactions = [...(state.transactions ?? [])];
		this.exchanges = state.exchanges ?? defaultExchanges(new Date());
		for (const holding of state.positions ?? []) {
			this.holdings.set(holding.ticker, {
				ticker: holding.ticker,
				quantity: holding.quantity,
				averagePrice: holding.averagePrice ?? this.priceOf(holding.ticker),
				inPies: holding.inPies ?? 0,
				createdAt: new Date(0).toISOString(),
			});
		}
	}

	/** Pass this as the client's `fetch`. */
	readonly fetch: FetchLike = async (input, init) => {
		if (init.signal?.aborted) throw init.signal.reason as Error;
		const url = new URL(input);
		if (url.origin === REPORT_HOST) return this.#download(await recordRequest(input, init));
		const request = await recordRequest(input, init);
		this.requests.push(request);
		const endpoint = this.#match(init.method ?? "GET", url.pathname);
		if (url.origin !== this.#origin || !endpoint) return toResponse(problem(404, "not-found", "Unknown route"));
		const failure = this.#failures.get(endpoint.definition.id as EndpointId)?.shift();
		if (failure && "network" in failure) throw networkError(failure.network);
		const response =
			failure ?? this.#authorise(init) ?? this.#route(endpoint.definition.id as EndpointId, request, endpoint.id);
		const limit = endpoint.definition.rateLimit;
		return toResponse({
			...response,
			headers: {
				"x-ratelimit-limit": String(limit.requests),
				"x-ratelimit-period": String(limit.periodMs / 1000),
				"x-ratelimit-remaining": String(limit.requests),
				"x-ratelimit-used": "0",
				"x-ratelimit-reset": String(Math.ceil((Date.now() + limit.periodMs) / 1000)),
				...response.headers,
			},
		});
	};

	/** Makes the next call to an endpoint fail. Queue several to fail several calls. */
	failNext(endpoint: EndpointId, failure: FakeFailure): this {
		const queue = this.#failures.get(endpoint) ?? [];
		queue.push(failure);
		this.#failures.set(endpoint, queue);
		return this;
	}

	setPrice(ticker: string, price: number): this {
		this.prices.set(ticker, price);
		return this;
	}

	priceOf(ticker: string): number {
		return this.prices.get(ticker) ?? 100;
	}

	/** Fills a pending limit or stop order, at its limit price, or `price` if given. */
	fill(orderId: number, price?: number): Order {
		const pending = this.pending.get(orderId);
		if (!pending) throw new Error(`The fake has no pending order ${orderId}.`);
		this.pending.delete(orderId);
		this.cash += pending.reservedCash;
		const execution =
			price ?? pending.order.limitPrice ?? pending.order.stopPrice ?? this.priceOf(pending.order.ticker ?? "");
		return this.#execute(pending.order, execution);
	}

	#authorise(init: RequestInit): ScriptedResponse | undefined {
		const authorization = new Headers(init.headers).get("authorization");
		return authorization === FAKE_AUTHORIZATION
			? undefined
			: { status: 401, body: { code: "AuthenticationFailed", message: "Bad API key" } };
	}

	#match(method: string, path: string): { definition: EndpointDefinition; id: number | undefined } | undefined {
		for (const definition of Object.values(ENDPOINTS) as EndpointDefinition[]) {
			if (definition.method !== method) continue;
			const pattern = new RegExp(`^${definition.path.replace("{id}", "(\\d+)")}$`);
			const match = pattern.exec(path);
			if (match) return { definition, id: match[1] === undefined ? undefined : Number(match[1]) };
		}
		return undefined;
	}

	#instrument(ticker: string): TradableInstrument | undefined {
		return this.instruments.find((instrument) => instrument.ticker === ticker);
	}

	#brief(ticker: string): { ticker: string; name: string | null; isin: string | null; currency: string | null } {
		const instrument = this.#instrument(ticker);
		return {
			ticker,
			name: instrument?.name ?? null,
			isin: instrument?.isin ?? null,
			currency: instrument?.currencyCode ?? null,
		};
	}

	#reservedShares(ticker: string): number {
		let reserved = 0;
		for (const pending of this.pending.values())
			if (pending.order.ticker === ticker) reserved += pending.reservedShares;
		return reserved;
	}

	position(ticker: string): Position | undefined {
		const holding = this.holdings.get(ticker);
		if (!holding) return undefined;
		const price = this.priceOf(ticker);
		const value = MONEY(holding.quantity * price);
		const cost = MONEY(holding.quantity * holding.averagePrice);
		return {
			instrument: this.#brief(ticker),
			quantity: holding.quantity,
			quantityInPies: holding.inPies,
			quantityAvailableForTrading: SHARES(holding.quantity - holding.inPies - this.#reservedShares(ticker)),
			averagePricePaid: holding.averagePrice,
			currentPrice: price,
			createdAt: holding.createdAt,
			walletImpact: {
				currency: this.currency,
				currentValue: value,
				totalCost: cost,
				unrealizedProfitLoss: MONEY(value - cost),
				fxImpact: 0,
			},
		};
	}

	#summary(): unknown {
		const positions = [...this.holdings.keys()].flatMap((ticker) => this.position(ticker) ?? []);
		const currentValue = MONEY(
			positions.reduce((total, position) => total + (position.walletImpact?.currentValue ?? 0), 0),
		);
		const totalCost = MONEY(positions.reduce((total, position) => total + (position.walletImpact?.totalCost ?? 0), 0));
		const reserved = [...this.pending.values()].reduce((total, pending) => total + pending.reservedCash, 0);
		return {
			id: this.accountId,
			currency: this.currency,
			totalValue: MONEY(this.cash + reserved + currentValue),
			cash: { availableToTrade: MONEY(this.cash), reservedForOrders: MONEY(reserved), inPies: 0 },
			investments: {
				currentValue,
				totalCost,
				realizedProfitLoss: MONEY(this.realisedProfitLoss),
				unrealizedProfitLoss: MONEY(currentValue - totalCost),
			},
		};
	}

	#route(id: EndpointId, request: RecordedRequest, pathId: number | undefined): ScriptedResponse {
		const body = (request.body ?? {}) as Record<string, unknown>;
		switch (id) {
			case "getAccountSummary":
				return { body: this.#summary() };
			case "listPositions": {
				const tickers = request.query.ticker ? [request.query.ticker] : [...this.holdings.keys()];
				return { body: tickers.flatMap((ticker) => this.position(ticker) ?? []) };
			}
			case "listInstruments":
				return { body: this.instruments };
			case "listExchanges":
				return { body: this.exchanges };
			case "listOrders":
				return { body: [...this.pending.values()].map((pending) => pending.order) };
			case "getOrder": {
				const pending = this.pending.get(pathId ?? 0);
				return pending ? { body: pending.order } : legacy(404, "OrderNotFound", "Order not found");
			}
			case "cancelOrder":
				return this.#cancel(pathId ?? 0);
			case "placeMarketOrder":
			case "placeLimitOrder":
			case "placeStopOrder":
			case "placeStopLimitOrder":
				return this.#place(id, body);
			case "listHistoricalOrders":
				return this.#page(request, this.orderHistory, (item) => item.order?.ticker ?? undefined);
			case "listDividends":
				return this.#page(request, this.dividends, (item) => item.ticker ?? undefined);
			case "listTransactions":
				return this.#page(request, this.transactions, () => undefined, true);
			case "listReports":
				return this.#listReports();
			case "requestReport":
				return this.#requestReport(body);
			case "listPies":
				return { body: [...this.pies.entries()].map(([pieId, pie]) => this.#pieSummary(pieId, pie.cash)) };
			case "getPie":
				return this.#pie(pathId ?? 0);
			case "createPie": {
				const pieId = this.#nextId++;
				this.pies.set(pieId, { settings: body, cash: 0 });
				return this.#pie(pieId);
			}
			case "updatePie": {
				const pie = this.pies.get(pathId ?? 0);
				if (!pie) return legacy(404, "PieNotFound", "Pie not found");
				pie.settings = { ...pie.settings, ...(body as PieRequest) };
				return this.#pie(pathId ?? 0);
			}
			case "deletePie":
				return this.pies.delete(pathId ?? 0) ? { status: 200 } : legacy(404, "PieNotFound", "Pie not found");
			case "duplicatePie": {
				const pie = this.pies.get(pathId ?? 0);
				if (!pie) return legacy(404, "PieNotFound", "Pie not found");
				const pieId = this.#nextId++;
				this.pies.set(pieId, { settings: { ...pie.settings, ...(body as PieRequest) }, cash: 0 });
				return this.#pie(pieId);
			}
		}
	}

	#pieSummary(id: number, cash: number): AccountBucketResultResponse {
		return { id, cash, progress: 0, status: "ON_TRACK", dividendDetails: { gained: 0, inCash: 0, reinvested: 0 } };
	}

	#pie(id: number): ScriptedResponse {
		const pie = this.pies.get(id);
		if (!pie) return legacy(404, "PieNotFound", "Pie not found");
		const details: AccountBucketInstrumentsDetailedResponse = {
			settings: { ...pie.settings, id, creationDate: new Date(0).toISOString() },
			instruments: Object.entries(pie.settings.instrumentShares ?? {}).map(([ticker, share]) => ({
				ticker,
				expectedShare: share,
				currentShare: 0,
				ownedQuantity: 0,
			})),
		};
		return { body: details };
	}

	#cancel(orderId: number): ScriptedResponse {
		const pending = this.pending.get(orderId);
		if (!pending) return legacy(404, "OrderNotFound", "Order not found");
		this.pending.delete(orderId);
		this.cash += pending.reservedCash;
		this.orderHistory.unshift({ order: { ...pending.order, status: "CANCELLED" } });
		return { status: 200 };
	}

	#place(id: EndpointId, body: Record<string, unknown>): ScriptedResponse {
		const ticker = typeof body.ticker === "string" ? body.ticker : "";
		const quantity = typeof body.quantity === "number" ? body.quantity : Number.NaN;
		if (!this.#instrument(ticker)) return legacy(400, "InstrumentNotFound", `No instrument ${ticker}`);
		if (!Number.isFinite(quantity) || quantity === 0)
			return problem(400, "invalid-quantity", "Quantity must not be zero");
		if (decimalPlaces(quantity) > 4) return problem(400, "quantity-precision-mismatch", "Quantity precision mismatch");
		if (id !== "placeMarketOrder" && "extendedHours" in body)
			return problem(400, "bad-request", "extendedHours is only valid for market orders");
		if (!this.marketOpen) return legacy(400, "MarketClosed", "The market is closed");
		const type =
			{
				placeMarketOrder: "MARKET",
				placeLimitOrder: "LIMIT",
				placeStopOrder: "STOP",
				placeStopLimitOrder: "STOP_LIMIT",
			}[id as string] ?? "MARKET";
		const limitPrice = typeof body.limitPrice === "number" ? body.limitPrice : undefined;
		const stopPrice = typeof body.stopPrice === "number" ? body.stopPrice : undefined;
		const price = limitPrice ?? stopPrice ?? this.priceOf(ticker);
		const buying = quantity > 0;
		const holding = this.holdings.get(ticker);
		const available = holding ? holding.quantity - holding.inPies - this.#reservedShares(ticker) : 0;
		if (buying && MONEY(quantity * price) > MONEY(this.cash)) {
			return legacy(400, "InsufficientFreeForStocksBuy", "Insufficient funds");
		}
		if (!buying && -quantity > SHARES(available) + 1e-9)
			return legacy(400, "SellingEquityNotOwned", "Selling equity not owned");
		const order: Order = {
			id: this.#nextId++,
			ticker,
			instrument: this.#brief(ticker),
			type,
			side: buying ? "BUY" : "SELL",
			status: "NEW",
			strategy: "QUANTITY",
			quantity: Math.abs(quantity),
			filledQuantity: 0,
			currency: this.#instrument(ticker)?.currencyCode ?? this.currency,
			initiatedFrom: "API",
			createdAt: new Date().toISOString(),
			extendedHours: body.extendedHours === true,
			...(limitPrice !== undefined && { limitPrice }),
			...(stopPrice !== undefined && { stopPrice }),
			...(typeof body.timeValidity === "string" && { timeInForce: body.timeValidity }),
		};
		if (type === "MARKET") {
			this.#execute(order, price);
			return { body: order };
		}
		const reservedCash = buying ? MONEY(quantity * price) : 0;
		this.cash -= reservedCash;
		this.pending.set(order.id ?? 0, { order, reservedCash, reservedShares: buying ? 0 : -quantity });
		return { body: order };
	}

	#execute(order: Order, price: number): Order {
		const ticker = order.ticker ?? "";
		const quantity = order.quantity ?? 0;
		const buying = order.side === "BUY";
		const value = MONEY(quantity * price);
		const holding = this.holdings.get(ticker);
		let realised = 0;
		if (buying) {
			this.cash = MONEY(this.cash - value);
			if (holding) {
				const total = holding.quantity + quantity;
				holding.averagePrice = (holding.averagePrice * holding.quantity + price * quantity) / total;
				holding.quantity = SHARES(total);
			} else {
				this.holdings.set(ticker, {
					ticker,
					quantity,
					averagePrice: price,
					inPies: 0,
					createdAt: new Date().toISOString(),
				});
			}
		} else if (holding) {
			realised = MONEY((price - holding.averagePrice) * quantity);
			this.cash = MONEY(this.cash + value);
			holding.quantity = SHARES(holding.quantity - quantity);
			if (holding.quantity <= 0) this.holdings.delete(ticker);
		}
		this.realisedProfitLoss += realised;
		const filled: Order = { ...order, status: "FILLED", filledQuantity: quantity, filledValue: value };
		this.orderHistory.unshift({
			order: filled,
			fill: {
				id: this.#nextId++,
				price,
				quantity,
				filledAt: new Date().toISOString(),
				type: "TRADE",
				tradingMethod: "TOTV",
				walletImpact: {
					currency: this.currency,
					fxRate: 1,
					netValue: buying ? -value : value,
					realisedProfitLoss: realised,
					taxes: [],
				},
			},
		});
		return filled;
	}

	#page<T>(
		request: RecordedRequest,
		all: readonly T[],
		tickerOf: (item: T) => string | undefined,
		withTime = false,
	): ScriptedResponse {
		const limit = request.query.limit === undefined ? 20 : Number(request.query.limit);
		if (!Number.isInteger(limit) || limit < 1 || limit > 50)
			return problem(400, "bad-filtering-arguments", "limit must be 1 to 50");
		const ticker = request.query.ticker;
		const items = ticker ? all.filter((item) => tickerOf(item) === ticker) : all;
		const start = request.query.cursor === undefined ? 0 : Number(request.query.cursor);
		const slice = items.slice(start, start + limit);
		const end = start + limit;
		let nextPagePath: string | null = null;
		if (end < items.length) {
			const query = new URLSearchParams({ limit: String(limit), cursor: String(end) });
			if (ticker) query.set("ticker", ticker);
			if (withTime) query.set("time", new Date(0).toISOString());
			nextPagePath = `${request.path}?${query.toString()}`;
		}
		return { body: { items: slice, nextPagePath } };
	}

	#exportsRefused(): ScriptedResponse | undefined {
		return this.environment === "demo" && !this.exportsOnDemo
			? problem(403, "not-available-in-demo-account", "Not available in demo account")
			: undefined;
	}

	#requestReport(body: Record<string, unknown>): ScriptedResponse {
		const refused = this.#exportsRefused();
		if (refused) return refused;
		const reportId = this.#nextId++;
		this.reports.push({
			reportId,
			status: "Queued",
			timeFrom: typeof body.timeFrom === "string" ? body.timeFrom : null,
			timeTo: typeof body.timeTo === "string" ? body.timeTo : null,
			dataIncluded: body.dataIncluded ?? null,
		});
		return { body: { reportId } };
	}

	#listReports(): ScriptedResponse {
		const refused = this.#exportsRefused();
		if (refused) return refused;
		const listed = this.reports.map((report) => ({ ...report }));
		// Each report finishes the time after it is first seen, so waiting code takes one poll.
		for (const report of this.reports) {
			if (report.status === "Queued") report.status = "Finished";
			if (report.status === "Finished")
				report.downloadLink = `${REPORT_HOST}/${report.reportId ?? 0}.csv?signature=fake`;
		}
		return { body: listed };
	}

	#download(request: RecordedRequest): Response {
		if (request.authorized) {
			return toResponse({ status: 400, body: "The fake refuses report downloads that carry API credentials." });
		}
		const id = Number(request.path.replace(/\D/g, ""));
		if (!this.reports.some((report) => report.reportId === id && report.status === "Finished"))
			return toResponse({ status: 404, body: "No such report" });
		const header =
			"Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total,Currency (Total)";
		const rows = this.orderHistory.map(({ order, fill }) =>
			[
				order?.side === "SELL" ? "Market sell" : "Market buy",
				fill?.filledAt ?? "",
				order?.instrument?.isin ?? "",
				order?.ticker ?? "",
				`"${order?.instrument?.name ?? ""}"`,
				fill?.quantity ?? "",
				fill?.price ?? "",
				order?.currency ?? "",
				Math.abs(fill?.walletImpact?.netValue ?? 0),
				this.currency,
			].join(","),
		);
		return toResponse({ body: `${[header, ...rows].join("\n")}\n`, headers: { "content-type": "text/csv" } });
	}
}
