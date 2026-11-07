import type { CacheStore } from "./cache";
import { BASE_URLS, type Environment, isEnvironment } from "./environment";
import { ConfigurationError } from "./errors/errors";
import type { RateLimitMode } from "./http/rateLimiter";
import { DEFAULT_RETRY, type ResolvedRetry, type RetryOptions } from "./http/retry";
import type { FetchLike, Hooks } from "./http/transport";
import type { Logger } from "./logging/logger";

export interface Trading212Options {
	/** Required, with no default: `demo` for paper trading or `live` for real money. */
	environment: Environment;
	/** The API key from the Trading 212 app, under Settings > API (Beta). */
	apiKey: string;
	/** The secret shown once when the key was made. */
	apiSecret: string;
	/**
	 * Whether this client may place or cancel orders and change pies. Defaults to `enabled` on Trading 212's demo host and
	 * `disabled` everywhere else, so a live client, or one behind a custom `baseUrl`, only reads until you say otherwise.
	 * `disabled` is honoured on demo too.
	 */
	trading?: "enabled" | "disabled";
	/** Per-request timeout. Default 15 s. */
	timeoutMs?: number;
	/** How reads are retried, or `false` for never. Trades are never retried. */
	retry?: RetryOptions | false;
	/** How to stay within Trading 212's per-endpoint limits. Default `pace`. */
	rateLimit?: RateLimitMode;
	/** The longest the client will wait for rate-limit budget before throwing `RateLimitError`. Default 60 s. */
	maxRateLimitWaitMs?: number;
	/** Where to send log lines. Default: nowhere. Every field is redacted first. */
	logger?: Logger;
	/** Callbacks for metrics and tracing. */
	hooks?: Hooks;
	/** Where to keep the instrument and exchange lists. Default: in memory, per client. */
	cache?: CacheStore;
	/** How long the instrument and exchange lists are kept. Default 1 hour; Trading 212 refreshes them every 10 minutes. */
	metadataTtlMs?: number;
	/** A `fetch` to use instead of the global one, for proxies and tests. */
	fetch?: FetchLike;
	/** Only for tests and proxies: must be `https://`, or `http://localhost`. */
	baseUrl?: string;
	/** Appended to the `User-Agent` this client sends. */
	userAgent?: string;
	/**
	 * The client refuses to start in a browser, because Trading 212 rejects browser requests and a key in a page is
	 * public. Set this only if you understand both.
	 */
	dangerouslyAllowBrowser?: boolean;
}

interface ResolvedOptions {
	readonly environment: Environment;
	readonly apiKey: string;
	readonly apiSecret: string;
	readonly trading: "enabled" | "disabled";
	readonly timeoutMs: number;
	readonly retry: ResolvedRetry | null;
	readonly rateLimit: RateLimitMode;
	readonly maxRateLimitWaitMs: number;
	readonly metadataTtlMs: number;
	readonly origin: string;
	readonly officialOrigin: boolean;
}

const ONE_HOUR = 60 * 60 * 1000;

function fail(field: string, message: string, hint?: string): never {
	throw new ConfigurationError(message, { field, ...(hint && { hint }) });
}

function checkCredential(field: "apiKey" | "apiSecret", value: unknown): string {
	const label = field === "apiKey" ? "API key" : "API secret";
	if (typeof value !== "string" || value.length === 0) {
		fail(field, `The ${label} is missing.`, "Create a key in the Trading 212 app under Settings > API (Beta).");
	}
	if (value.trim() !== value) {
		fail(field, `The ${label} starts or ends with whitespace.`, "This is usually a copy-paste slip: trim it.");
	}
	if (/\s/.test(value)) fail(field, `The ${label} contains whitespace.`, "Copy it again from the Trading 212 app.");
	return value;
}

function positiveMs(field: string, value: unknown, fallback: number, max: number): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
		fail(field, `${field} must be a positive number of milliseconds no greater than ${max}.`);
	}
	return Math.ceil(value);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function resolveOrigin(baseUrl: string | undefined, environment: Environment): { origin: string; official: boolean } {
	const official = BASE_URLS[environment];
	if (baseUrl === undefined) return { origin: official, official: true };
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		fail("baseUrl", "baseUrl is not a valid URL.");
	}
	if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
		fail(
			"baseUrl",
			"baseUrl must use https://, so your key is never sent in the clear.",
			"Only http://localhost is allowed without TLS.",
		);
	}
	if (url.username || url.password) fail("baseUrl", "baseUrl must not contain a username or password.");
	if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
		fail("baseUrl", "baseUrl must be an origin only, such as https://demo.trading212.com, with no path.");
	}
	const other = environment === "demo" ? "live" : "demo";
	if (url.origin === BASE_URLS[other]) {
		fail(
			"baseUrl",
			`baseUrl is Trading 212's ${other} host, but environment is "${environment}".`,
			`Set environment to "${other}" instead of pointing baseUrl at it.`,
		);
	}
	return { origin: url.origin, official: url.origin === official };
}

const ENVIRONMENT_ALIASES = new Map<string, Environment>([
	["prod", "live"],
	["production", "live"],
	["real", "live"],
	["paper", "demo"],
	["practice", "demo"],
	["sandbox", "demo"],
	["test", "demo"],
]);

// Names people reach for get a pointer to the right one, never a silent guess, because live trades real money.
function environmentHint(value: unknown, field: string): string {
	const alias = typeof value === "string" ? ENVIRONMENT_ALIASES.get(value.trim().toLowerCase()) : undefined;
	if (alias) return `Trading 212 calls that environment "${alias}": set ${field} to ${alias}.`;
	return `Set ${field} to demo or live. There is deliberately no default, because live trades real money.`;
}

function isBrowser(): boolean {
	const scope = globalThis as { document?: unknown; window?: unknown };
	return typeof scope.document === "object" && typeof scope.window === "object";
}

export function resolveOptions(options: Trading212Options): ResolvedOptions {
	if (typeof options !== "object" || (options as unknown) === null) fail("options", "Pass an options object.");
	if (!isEnvironment(options.environment)) {
		fail("environment", 'environment must be "demo" or "live".', environmentHint(options.environment, "environment"));
	}
	if (isBrowser() && !options.dangerouslyAllowBrowser) {
		fail(
			"dangerouslyAllowBrowser",
			"trading212.js refuses to run in a browser.",
			"Trading 212 rejects requests from web pages, and any key you ship to a browser is public. Call the API from a server instead.",
		);
	}
	const apiKey = checkCredential("apiKey", options.apiKey);
	const apiSecret = checkCredential("apiSecret", options.apiSecret);
	if (apiKey === apiSecret) {
		fail("apiSecret", "The API secret is the same as the API key.", "Paste the secret, not the key, into apiSecret.");
	}
	if (apiKey.includes(":")) fail("apiKey", "The API key contains a colon, which no Trading 212 key has.");
	const trading: unknown = options.trading;
	if (trading !== undefined && trading !== "enabled" && trading !== "disabled") {
		fail("trading", 'trading must be "enabled" or "disabled".');
	}
	if (options.rateLimit !== undefined && !["pace", "burst", "off"].includes(options.rateLimit)) {
		fail("rateLimit", 'rateLimit must be "pace", "burst" or "off".');
	}
	let retry: ResolvedRetry | null = DEFAULT_RETRY;
	if (options.retry === false) retry = null;
	else if (options.retry) {
		const maxAttempts = options.retry.maxAttempts ?? DEFAULT_RETRY.maxAttempts;
		if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
			fail("retry.maxAttempts", "retry.maxAttempts must be a whole number from 1 to 10.");
		}
		retry = {
			maxAttempts,
			baseDelayMs: positiveMs("retry.baseDelayMs", options.retry.baseDelayMs, DEFAULT_RETRY.baseDelayMs, 60_000),
			maxDelayMs: positiveMs("retry.maxDelayMs", options.retry.maxDelayMs, DEFAULT_RETRY.maxDelayMs, 300_000),
		};
	}
	const { origin: resolvedOrigin, official } = resolveOrigin(options.baseUrl, options.environment);
	return {
		environment: options.environment,
		apiKey,
		apiSecret,
		// Only Trading 212's own demo host may trade by default: a proxy could forward anywhere, including live.
		trading: options.trading ?? (options.environment === "demo" && official ? "enabled" : "disabled"),
		timeoutMs: positiveMs("timeoutMs", options.timeoutMs, 15_000, 600_000),
		retry,
		rateLimit: options.rateLimit ?? "pace",
		maxRateLimitWaitMs: positiveMs("maxRateLimitWaitMs", options.maxRateLimitWaitMs, 60_000, 3_600_000),
		metadataTtlMs: positiveMs("metadataTtlMs", options.metadataTtlMs, ONE_HOUR, 7 * 24 * ONE_HOUR),
		origin: resolvedOrigin,
		officialOrigin: official,
	};
}

export type EnvSource = Record<string, string | undefined>;

/**
 * Reads `T212_ENV`, `T212_API_KEY` and `T212_API_SECRET`, the names Trading 212's own tools use. With
 * `T212_ENV=demo`, `T212_DEMO_API_KEY` and `T212_DEMO_API_SECRET` are used when the plain ones are unset, and the
 * same for live. Nothing is read from `.env` files.
 */
export function optionsFromEnv(env?: EnvSource): Pick<Trading212Options, "environment" | "apiKey" | "apiSecret"> {
	const source = env ?? (globalThis as { process?: { env?: EnvSource } }).process?.env ?? {};
	const environment = source.T212_ENV?.trim().toLowerCase();
	if (!isEnvironment(environment)) {
		fail(
			"T212_ENV",
			environment ? `T212_ENV is "${environment}", which is neither demo nor live.` : "T212_ENV is not set.",
			environmentHint(environment, "T212_ENV"),
		);
	}
	const prefix = environment === "demo" ? "T212_DEMO" : "T212_LIVE";
	// A blank value, as in .env.example, counts as unset.
	const read = (name: string): string | undefined => (source[name] === "" ? undefined : source[name]);
	const apiKey = read("T212_API_KEY") ?? read(`${prefix}_API_KEY`);
	const apiSecret = read("T212_API_SECRET") ?? read(`${prefix}_API_SECRET`);
	if (!apiKey) fail("T212_API_KEY", `Neither T212_API_KEY nor ${prefix}_API_KEY is set.`);
	if (!apiSecret) fail("T212_API_SECRET", `Neither T212_API_SECRET nor ${prefix}_API_SECRET is set.`);
	return { environment, apiKey, apiSecret };
}

/** The `Authorization` header: Basic, with the key as username and the secret as password, UTF-8 encoded. */
export function basicAuthorization(apiKey: string, apiSecret: string): string {
	const bytes = new TextEncoder().encode(`${apiKey}:${apiSecret}`);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `Basic ${btoa(binary)}`;
}
