import { InstrumentNotFoundError, ValidationError } from "../errors/errors";
import { ENDPOINTS } from "../http/endpoints.generated";
import type { TradableInstrument } from "../types/api.generated";

import type { ResourceContext } from "./context";

/** The list is shared between callers, so it is fetched with the client's own timeout rather than a per-call one. */
export interface ListOptions {
	/** Ignore the cache and fetch afresh. */
	refresh?: boolean;
	/** Stops this caller waiting; a download other callers share carries on. */
	signal?: AbortSignal;
}

export interface SearchOptions extends ListOptions {
	/** Most results to return. Default 10. */
	limit?: number;
	/** Only this instrument type, such as `STOCK` or `ETF`. */
	type?: string;
	/** Only instruments traded in this currency, such as `USD` or `GBX`. */
	currency?: string;
}

export interface ResolveOptions extends ListOptions {
	type?: string;
	currency?: string;
}

function matchScore(instrument: TradableInstrument, query: string): number {
	const q = query.toLowerCase();
	const ticker = instrument.ticker?.toLowerCase() ?? "";
	const short = instrument.shortName?.toLowerCase() ?? "";
	const name = instrument.name?.toLowerCase() ?? "";
	const isin = instrument.isin?.toLowerCase() ?? "";
	if (ticker === q) return 100;
	if (isin === q) return 95;
	if (short === q) return 90;
	if (ticker.startsWith(`${q}_`)) return 85;
	if (name === q) return 80;
	if (name.startsWith(q)) return 60;
	if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name)) return 50;
	if (short.startsWith(q) || ticker.startsWith(q)) return 40;
	if (name.includes(q)) return 30;
	return 0;
}

function passesFilters(instrument: TradableInstrument, options: { type?: string; currency?: string }): boolean {
	if (options.type && instrument.type?.toUpperCase() !== options.type.toUpperCase()) return false;
	if (options.currency && instrument.currencyCode?.toUpperCase() !== options.currency.toUpperCase()) return false;
	return true;
}

export class InstrumentsResource {
	readonly #context: ResourceContext;

	constructor(context: ResourceContext) {
		this.#context = context;
	}

	/**
	 * Every instrument the account can trade: about 5 MB, so it is cached (one hour by default) and concurrent callers
	 * share one download.
	 *
	 * Scope `metadata` · 1 request / 50 s.
	 */
	async list(options: ListOptions = {}): Promise<TradableInstrument[]> {
		const { refresh = false, signal } = options;
		const { cache, cacheNamespace, metadataTtlMs, transport } = this.#context;
		return cache.load(
			`${cacheNamespace}:instruments`,
			metadataTtlMs,
			refresh,
			async () => {
				const { data } = await transport.request<TradableInstrument[] | undefined>(ENDPOINTS.listInstruments);
				return Array.isArray(data) ? data : [];
			},
			signal,
		);
	}

	/**
	 * Finds instruments by ticker, ISIN, short name or name, best match first. Searches the cached list, so it costs
	 * no request after the first.
	 *
	 * @example
	 * const [apple] = await t212.instruments.search("Apple", { currency: "USD" });
	 */
	async search(query: string, options: SearchOptions = {}): Promise<TradableInstrument[]> {
		const { limit = 10, type, currency, ...list } = options;
		const trimmed = query.trim();
		if (!trimmed)
			throw new ValidationError("Search for something: the query is empty.", {
				issues: [{ field: "query", message: "is empty" }],
			});
		const filters = { ...(type && { type }), ...(currency && { currency }) };
		return (await this.list(list))
			.filter((instrument) => passesFilters(instrument, filters))
			.map((instrument) => ({ instrument, score: matchScore(instrument, trimmed) }))
			.filter((entry) => entry.score > 0)
			.sort((a, b) => b.score - a.score || (a.instrument.ticker ?? "").localeCompare(b.instrument.ticker ?? ""))
			.slice(0, limit)
			.map((entry) => entry.instrument);
	}

	/** The instrument with exactly this Trading 212 ticker, or `undefined`. */
	async find(ticker: string, options: ListOptions = {}): Promise<TradableInstrument | undefined> {
		return (await this.list(options)).find((instrument) => instrument.ticker === ticker);
	}

	/**
	 * Turns what a person would type (`AAPL`, `Apple`, an ISIN) into exactly one instrument, or throws
	 * `InstrumentNotFoundError` listing the closest matches when none or several fit.
	 *
	 * @example
	 * const apple = await t212.instruments.resolve("AAPL", { currency: "USD" }); // AAPL_US_EQ
	 */
	async resolve(query: string, options: ResolveOptions = {}): Promise<TradableInstrument> {
		const { type, currency, ...list } = options;
		const ranked = await this.search(query, {
			...list,
			limit: 10,
			...(type && { type }),
			...(currency && { currency }),
		});
		const best = ranked[0];
		const top = best ? matchScore(best, query.trim()) : 0;
		const tied = ranked.filter((instrument) => matchScore(instrument, query.trim()) === top);
		// An exact ticker, ISIN, short name or full name counts; a prefix or a word inside the name does not.
		if (best && top >= 80 && tied.length === 1) return best;
		const suggestions = ranked
			.slice(0, 5)
			.map((instrument) => ({ ticker: instrument.ticker ?? "", name: instrument.name ?? undefined }));
		const why =
			ranked.length === 0
				? "nothing matched"
				: tied.length > 1
					? `${tied.length} instruments match equally well`
					: "no instrument matched exactly";
		throw new InstrumentNotFoundError(`Could not resolve "${query}" to one instrument: ${why}.`, {
			query,
			suggestions,
			hint:
				suggestions.length > 0
					? `Did you mean ${suggestions.map((suggestion) => suggestion.ticker).join(", ")}? Narrow it with { currency } or { type }, or pass the exact ticker.`
					: "Check the spelling, or search with instruments.search().",
		});
	}
}
