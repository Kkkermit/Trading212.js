export { Trading212, type VerifyResult } from "./client";
export type { EnvSource, Trading212Options } from "./config";
export { BASE_URLS, type Environment } from "./environment";

export {
	AuthenticationError,
	ConfigurationError,
	type ErrorCode,
	type ErrorDetails,
	HttpError,
	InstrumentNotFoundError,
	type InstrumentSuggestion,
	isTrading212Error,
	MissingScopeError,
	NetworkError,
	NotAvailableInDemoError,
	NotFoundError,
	OrderOutcomeUnknownError,
	OrderRejectedError,
	type OrderRejectionReason,
	PermissionError,
	RateLimitError,
	type RequestDescription,
	ServerError,
	TimeoutError,
	Trading212Error,
	TradingDisabledError,
	UnexpectedResponseError,
	ValidationError,
	type ValidationIssue,
} from "./errors/errors";
export { parseErrorBody, type ParsedErrorBody } from "./errors/fromResponse";

export type { EndpointDefinition, EndpointKind, EndpointRateLimit, HttpMethod } from "./http/endpoint";
export { ENDPOINTS, type EndpointId, SPEC_VERSION } from "./http/endpoints.generated";
export type { RateLimitInfo } from "./http/rateLimitHeaders";
export type { EndpointBudget, RateLimitMode } from "./http/rateLimiter";
export type { RetryOptions } from "./http/retry";
export type {
	CallOptions,
	FetchLike,
	Hooks,
	RateLimitWaitEvent,
	RequestEvent,
	ResponseEvent,
	RetryEvent,
} from "./http/transport";

export { type CacheStore, MemoryCache } from "./cache";
export {
	type ConsoleLike,
	consoleLogger,
	fieldsFirst,
	type FieldsFirstMethod,
	type LogFields,
	type Logger,
	type LogLevel,
	silentLogger,
} from "./logging/logger";

export { decimalPlaces, isValidQuantity, QUANTITY_DECIMALS, truncateQuantity } from "./orders/quantity";
export { type OrderTimeValidity, type OrderType, TIME_VALIDITIES } from "./orders/validate";
export type { IterateOptions, Page, PageOptions, PagedList } from "./pagination";

export type { AccountResource } from "./resources/account";
export { type ExchangesResource, type MarketSession, type MarketStatus, sessionAt } from "./resources/exchanges";
export type { HistoryResource } from "./resources/history";
export type { InstrumentsResource, ListOptions, ResolveOptions, SearchOptions } from "./resources/instruments";
export {
	type DryRunResult,
	FINAL_ORDER_STATUSES,
	type LimitOrderRequest,
	type MarketOrderRequest,
	type OrderInput,
	type OrdersResource,
	type PlaceOptions,
	type Placed,
	type SellAllOptions,
	type StopLimitOrderRequest,
	type StopOrderRequest,
	type WaitOptions,
} from "./resources/orders";
export type { PiesResource } from "./resources/pies";
export {
	buildPortfolioSnapshot,
	type HoldingSnapshot,
	type PortfolioResource,
	type PortfolioSnapshot,
} from "./resources/portfolio";
export type { PositionsResource } from "./resources/positions";
export type { ExportResult, ReportRequest, ReportsResource, ReportWaitOptions } from "./resources/reports";

export type * from "./types/public";
export { VERSION } from "./version";
