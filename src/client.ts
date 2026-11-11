import { CachedLoader, MemoryCache } from "./cache";
import { basicAuthorization, type EnvSource, optionsFromEnv, resolveOptions, type Trading212Options } from "./config";
import type { Environment } from "./environment";
import { ConfigurationError } from "./errors/errors";
import { type EndpointId } from "./http/endpoints.generated";
import { type EndpointBudget, RateLimiter } from "./http/rateLimiter";
import { type CallOptions, type FetchLike, Transport } from "./http/transport";
import { fingerprint } from "./internal/hash";
import { safeLogger } from "./logging/logger";
import { createRedactor, createSecretFilter } from "./logging/redact";
import { AccountResource } from "./resources/account";
import type { ResourceContext } from "./resources/context";
import { ExchangesResource } from "./resources/exchanges";
import { HistoryResource } from "./resources/history";
import { InstrumentsResource } from "./resources/instruments";
import { OrdersResource } from "./resources/orders";
import { PiesResource } from "./resources/pies";
import { PortfolioResource } from "./resources/portfolio";
import { PositionsResource } from "./resources/positions";
import { ReportsResource } from "./resources/reports";
import { WatchResource } from "./resources/watch";
import { VERSION } from "./version";

/** What `verify()` learnt about the key. */
export interface VerifyResult {
	readonly environment: Environment;
	/** The account number shown in the Trading 212 app. */
	readonly accountId: number | undefined;
	/** The account's primary currency, such as `GBP`. */
	readonly currency: string | undefined;
	/** Whether this client may place orders. */
	readonly trading: "enabled" | "disabled";
}

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/**
 * A client for one Trading 212 account in one environment.
 *
 * @example
 * const t212 = new Trading212({ environment: "demo", apiKey, apiSecret });
 * const { totalValue } = await t212.account.summary();
 */
export class Trading212 {
	readonly environment: Environment;
	/** Cash and totals. */
	readonly account: AccountResource;
	/** Open positions. */
	readonly positions: PositionsResource;
	/** Everything you can trade, cached, with search and ticker lookup. */
	readonly instruments: InstrumentsResource;
	/** Exchanges, their schedules, and whether a market is open. */
	readonly exchanges: ExchangesResource;
	/** Place, inspect, cancel and wait for orders. */
	readonly orders: OrdersResource;
	/** Past orders, dividends and transactions, paginated. */
	readonly history: HistoryResource;
	/** CSV exports. */
	readonly reports: ReportsResource;
	/** The account summary and positions combined. */
	readonly portfolio: PortfolioResource;
	/** Watchers that report orders, positions and cash changing. */
	readonly watch: WatchResource;
	/**
	 * Pies.
	 *
	 * @deprecated Trading 212 has deprecated the pies endpoints; they may be removed.
	 */
	readonly pies: PiesResource;

	readonly #transport: Transport;

	constructor(options: Trading212Options) {
		const resolved = resolveOptions(options);
		const authorization = basicAuthorization(resolved.apiKey, resolved.apiSecret);
		const secrets = [resolved.apiKey, resolved.apiSecret, authorization.slice("Basic ".length)];
		const redact = createRedactor(secrets);
		const logger = safeLogger(resolved.logger, redact);
		const fetchImpl: FetchLike | undefined =
			options.fetch ?? (globalThis.fetch as FetchLike | undefined)?.bind(globalThis);
		if (!fetchImpl) {
			throw new ConfigurationError("No fetch implementation is available.", {
				field: "fetch",
				hint: "Use Node 22 or later, Bun or Deno, or pass one as the fetch option.",
			});
		}
		if (!resolved.officialOrigin) {
			logger.warn(`Requests go to ${resolved.origin}, which is not Trading 212's ${resolved.environment} host.`, {
				origin: resolved.origin,
			});
		}
		const accountKey = fingerprint(`${resolved.environment}\u0000${resolved.origin}\u0000${resolved.apiKey}`);
		this.environment = resolved.environment;
		this.#transport = new Transport({
			environment: resolved.environment,
			origin: resolved.origin,
			authorization,
			fetch: fetchImpl,
			timeoutMs: resolved.timeoutMs,
			retry: resolved.retry,
			rateLimiter: new RateLimiter(accountKey, resolved.rateLimit),
			maxRateLimitWaitMs: resolved.maxRateLimitWaitMs,
			logger,
			hooks: options.hooks ?? {},
			redact,
			removeSecrets: createSecretFilter(secrets),
			userAgent: `trading212.js/${VERSION}${options.userAgent ? ` ${options.userAgent}` : ""}`,
			trading: resolved.trading,
		});
		const context: ResourceContext = {
			transport: this.#transport,
			cache: new CachedLoader(options.cache ?? new MemoryCache(), (error, key) => {
				logger.warn(`The cache store failed for the ${key.split(":").pop() ?? "metadata"} list, so it was bypassed.`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}),
			cacheNamespace: accountKey,
			metadataTtlMs: resolved.metadataTtlMs,
			fetch: fetchImpl,
			timeoutMs: resolved.timeoutMs,
			logger,
		};
		this.account = new AccountResource(context);
		this.positions = new PositionsResource(context);
		this.instruments = new InstrumentsResource(context);
		this.exchanges = new ExchangesResource(context, this.instruments);
		this.history = new HistoryResource(context);
		this.orders = new OrdersResource(context, this.positions, this.history.orders);
		this.reports = new ReportsResource(context);
		this.portfolio = new PortfolioResource(this.account, this.positions);
		this.watch = new WatchResource(this.account, this.positions, this.orders, this.history.orders, logger);
		// eslint-disable-next-line @typescript-eslint/no-deprecated -- deprecated upstream, still offered
		this.pies = new PiesResource(context);
	}

	/**
	 * Builds a client from `T212_ENV`, `T212_API_KEY` and `T212_API_SECRET` (or `T212_DEMO_*` / `T212_LIVE_*`).
	 * `overrides` sets any other option.
	 *
	 * @example
	 * const t212 = Trading212.fromEnv({ logger: consoleLogger() });
	 */
	static fromEnv(overrides: Partial<Trading212Options> = {}, env?: EnvSource): Trading212 {
		return new Trading212({ ...optionsFromEnv(env), ...overrides });
	}

	/** Whether this client may place or cancel orders and change pies. */
	get trading(): "enabled" | "disabled" {
		return this.#transport.tradingEnabled ? "enabled" : "disabled";
	}

	/**
	 * Checks the key works, with one request, and says which account it belongs to. A wrong key or environment fails
	 * here with an `AuthenticationError` that explains which.
	 */
	async verify(options: CallOptions = {}): Promise<VerifyResult> {
		const summary = await this.account.summary(options);
		return {
			environment: this.environment,
			accountId: summary.id ?? undefined,
			currency: summary.currency ?? undefined,
			trading: this.trading,
		};
	}

	/** What is known about every endpoint's rate-limit budget, shared by every client using this key. */
	rateLimits(): Record<EndpointId, EndpointBudget> {
		return this.#transport.rateLimitSnapshot();
	}

	toJSON(): Record<string, unknown> {
		return { environment: this.environment, trading: this.trading, origin: this.#transport.origin };
	}

	[INSPECT](): string {
		return `Trading212 { environment: '${this.environment}', trading: '${this.trading}' }`;
	}
}
