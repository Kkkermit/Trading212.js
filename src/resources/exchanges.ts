import { isList } from "../cache";
import { InstrumentNotFoundError, TimeoutError } from "../errors/errors";
import { ENDPOINTS } from "../http/endpoints.generated";
import { durationOption } from "../internal/duration";
import { sleep } from "../internal/sleep";
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

export interface OpenOptions extends ListOptions {
	/** Count pre-market, after-hours and overnight sessions as open. Default false: regular hours only. */
	extendedHours?: boolean;
}

export interface WaitUntilOpenOptions extends OpenOptions {
	/** Give up with a `TimeoutError` after this long, or straight away if the market opens later. Default: no limit. */
	timeoutMs?: number;
}

// Long waits are taken in steps, so a schedule that changes or a timer limit cannot leave the wait stuck.
const MAX_SLEEP_MS = 60 * 60_000;

const isOpenIn = (status: MarketStatus, extendedHours: boolean | undefined): boolean =>
	status.open || (extendedHours === true && status.extendedHours);

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

	/**
	 * Whether an instrument's market is open now: regular hours, or any session with `{ extendedHours: true }`.
	 *
	 * @example
	 * if (await t212.exchanges.isOpen("AAPL_US_EQ")) await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 });
	 */
	async isOpen(ticker: string | TradableInstrument, options: OpenOptions = {}): Promise<boolean> {
		const { extendedHours, ...list } = options;
		return isOpenIn(await this.status(ticker, new Date(), list), extendedHours);
	}

	/**
	 * Resolves with the market's status once it opens, straight away if it is open now. It sleeps until the opening
	 * the schedule gives rather than polling, and checks again when it wakes, so a changed schedule is followed.
	 *
	 * @example
	 * await t212.exchanges.waitUntilOpen("AAPL_US_EQ", { timeoutMs: 12 * 60 * 60_000 });
	 */
	async waitUntilOpen(ticker: string | TradableInstrument, options: WaitUntilOpenOptions = {}): Promise<MarketStatus> {
		const { extendedHours, timeoutMs: given, ...list } = options;
		const timeoutMs = durationOption(given, "timeoutMs");
		const deadline = timeoutMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
		for (;;) {
			const now = Date.now();
			const status = await this.status(ticker, new Date(now), list);
			if (isOpenIn(status, extendedHours)) return status;
			const opens = (extendedHours ? status.next?.at : undefined) ?? status.nextOpen;
			if (opens && opens.getTime() > deadline) {
				throw new TimeoutError(
					`${status.ticker} opens at ${opens.toISOString()}, after the ${timeoutMs ?? 0} ms timeout.`,
					{
						hint: "Wait longer, or check exchanges.status() for the schedule.",
					},
				);
			}
			if (now >= deadline) {
				throw new TimeoutError(`${status.ticker} did not open within ${timeoutMs ?? 0} ms.`, {
					hint: "Trading 212's schedule did not say when it opens next. Check exchanges.status() later.",
				});
			}
			const untilOpen = opens ? opens.getTime() - now : MAX_SLEEP_MS;
			await sleep(Math.min(untilOpen, MAX_SLEEP_MS, deadline - now), list.signal);
		}
	}
}
