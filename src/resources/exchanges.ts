import { isList } from "../cache";
import { InstrumentNotFoundError } from "../errors/errors";
import { ENDPOINTS } from "../http/endpoints.generated";
import type { Exchange, TimeEvent, TradableInstrument } from "../types/api.generated";

import type { ResourceContext } from "./context";
import type { InstrumentsResource, ListOptions } from "./instruments";

/** Where an instrument's market is in its day. Pre-market, after-hours and overnight are extended-hours sessions. */
export type MarketSession = "regular" | "preMarket" | "afterHours" | "overnight" | "closed" | "unknown";

export interface MarketStatus {
	readonly ticker: string;
	/** The exchange's name, when Trading 212 listed it. */
	readonly exchange: string | undefined;
	readonly session: MarketSession;
	/** True during regular trading hours. */
	readonly open: boolean;
	/** True during a pre-market, after-hours or overnight session. */
	readonly extendedHours: boolean;
	/** When the current session began. */
	readonly since: Date | undefined;
	/** The next scheduled change, such as the close. */
	readonly next: { readonly event: string; readonly at: Date } | undefined;
	/** When regular trading next starts, including the end of a break, if the schedule reaches that far. */
	readonly nextOpen: Date | undefined;
}

const SESSION_AFTER: Record<string, MarketSession> = {
	OPEN: "regular",
	BREAK_END: "regular",
	PRE_MARKET_OPEN: "preMarket",
	AFTER_HOURS_OPEN: "afterHours",
	OVERNIGHT_OPEN: "overnight",
	CLOSE: "closed",
	BREAK_START: "closed",
	AFTER_HOURS_CLOSE: "closed",
};

// At the same instant a close sorts before an open, so the session that starts then is the one shown.
const eventOrder = (type: string): number => (SESSION_AFTER[type] === "closed" ? 0 : 1);

interface DatedEvent {
	readonly type: string;
	readonly at: Date;
}

function sortedEvents(events: readonly TimeEvent[]): DatedEvent[] {
	return events
		.flatMap((event) => {
			const at = event.date ? new Date(event.date) : undefined;
			return event.type && at && !Number.isNaN(at.getTime()) ? [{ type: event.type, at }] : [];
		})
		.sort((a, b) => a.at.getTime() - b.at.getTime() || eventOrder(a.type) - eventOrder(b.type));
}

/** Works out the session at `at` from a working schedule. Pure, so it can be tested and reused offline. */
export function sessionAt(
	events: readonly TimeEvent[],
	at: Date,
): Pick<MarketStatus, "session" | "since" | "next" | "nextOpen"> {
	const sorted = sortedEvents(events);
	const time = at.getTime();
	const previous = sorted.filter((event) => event.at.getTime() <= time).pop();
	const upcoming = sorted.filter((event) => event.at.getTime() > time);
	const next = upcoming[0];
	return {
		session: previous ? (SESSION_AFTER[previous.type] ?? "unknown") : "unknown",
		since: previous?.at,
		next: next && { event: next.type, at: next.at },
		nextOpen: upcoming.find((event) => SESSION_AFTER[event.type] === "regular")?.at,
	};
}

export class ExchangesResource {
	readonly #context: ResourceContext;
	readonly #instruments: InstrumentsResource;

	constructor(context: ResourceContext, instruments: InstrumentsResource) {
		this.#context = context;
		this.#instruments = instruments;
	}

	/**
	 * Every exchange and its working schedules, cached like the instrument list.
	 *
	 * Scope `metadata` · 1 request / 30 s.
	 */
	async list(options: ListOptions = {}): Promise<Exchange[]> {
		const { refresh = false, signal } = options;
		const { cache, cacheNamespace, metadataTtlMs, transport } = this.#context;
		return cache.load(
			`${cacheNamespace}:exchanges`,
			{ ttlMs: metadataTtlMs, refresh, signal, accept: isList<Exchange> },
			async () => {
				const { data } = await transport.request<Exchange[] | undefined>(ENDPOINTS.listExchanges);
				return Array.isArray(data) ? data : [];
			},
		);
	}

	/**
	 * Whether an instrument's market is open, read from Trading 212's working schedules, so you can check before an
	 * order is refused with `market-closed`. The schedules cover a limited window ahead, so `nextOpen` can be undefined.
	 *
	 * @example
	 * const { open, next } = await t212.exchanges.status("AAPL_US_EQ");
	 */
	async status(
		ticker: string | TradableInstrument,
		at: Date = new Date(),
		options: ListOptions = {},
	): Promise<MarketStatus> {
		const instrument = typeof ticker === "string" ? await this.#instruments.find(ticker, options) : ticker;
		const name = typeof ticker === "string" ? ticker : (ticker.ticker ?? "");
		if (!instrument) {
			throw new InstrumentNotFoundError(`No instrument has the ticker "${name}".`, {
				query: name,
				suggestions: [],
				hint: "Use instruments.resolve() to turn a symbol or name into a Trading 212 ticker.",
			});
		}
		const exchanges = await this.list(options);
		for (const exchange of exchanges) {
			const schedule = exchange.workingSchedules?.find((candidate) => candidate.id === instrument.workingScheduleId);
			if (schedule) {
				const state = sessionAt(schedule.timeEvents ?? [], at);
				return {
					ticker: name,
					exchange: exchange.name ?? undefined,
					...state,
					open: state.session === "regular",
					extendedHours: ["preMarket", "afterHours", "overnight"].includes(state.session),
				};
			}
		}
		return {
			ticker: name,
			exchange: undefined,
			session: "unknown",
			open: false,
			extendedHours: false,
			since: undefined,
			next: undefined,
			nextOpen: undefined,
		};
	}
}
