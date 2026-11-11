import type { Environment } from "../environment";
import type { EndpointKind } from "../http/endpoint";

export const HINTS = {
	authentication: (environment: Environment): string =>
		`Trading 212 refused the key and secret. Check both were copied exactly, with no spaces. A key works in one environment only: this client is set to ${environment}, so the key must have been made while the app was in ${environment === "demo" ? "practice (demo)" : "real-money (live)"} mode.`,
	missingScope: (scope: string): string =>
		`This API key does not have the "${scope}" permission. In the Trading 212 app, go to Settings > API (Beta) and create a key with "${scope}" ticked.`,
	notAvailableInDemo:
		"Trading 212 does not offer this in the demo environment. It works on live only (CSV exports are one example).",
	permission:
		"The key is not allowed to do this. If the key is restricted to IP addresses, check that this machine's public address is on its list.",
	validation:
		"Trading 212 rejected the request as invalid. `error.body` holds its explanation, and `error.issues` any field problems found before sending.",
	invalidOrder:
		"Trading 212 could not accept the fields of this order. The client checks them before sending, so if one of its methods sent it, Trading 212 may have changed its rules: please open an issue with `error.traceId`.",
	timeout: (kind: EndpointKind): string =>
		kind === "read"
			? "Trading 212 did not answer in time. Reads are retried automatically; this one ran out of attempts."
			: "Trading 212 did not answer in time. Requests that change something are never retried automatically.",
	outcomeUnknown:
		"The request may or may not have gone through. Do not resend it blindly: `orders.findAfterUnknown(error)` looks for an order first, and `orders.list()` shows what is still pending.",
	rateLimited: (endpoint: string | undefined, resetAt: number | undefined): string =>
		`Wait${resetAt === undefined ? " a moment" : ` until ${new Date(resetAt).toISOString()}`} before calling ${endpoint ?? "this endpoint"} again. Limits apply per account, so every program using the same account shares them.`,
	server: (kind: EndpointKind): string =>
		kind === "read"
			? "Trading 212 had a problem of its own. Reads are retried automatically; this one ran out of attempts."
			: "Trading 212 had a problem of its own. Requests that change something are never retried automatically.",
	tradingDisabled:
		'Trading is off for this client, which is the default on live and behind a custom baseUrl, so nothing was sent. Pass `trading: "enabled"` to place orders, or `{ dryRun: true }` to preview one.',
	network: (sent: boolean, kind: EndpointKind): string => {
		if (!sent) return "Could not reach Trading 212 at all: check the network, DNS and any proxy. Nothing was sent.";
		return kind === "read"
			? "The connection broke while waiting for Trading 212. Reads are retried automatically; this one ran out of attempts."
			: "The connection broke while waiting for Trading 212. Requests that change something are never retried automatically.";
	},
} as const;

export const ORDER_REJECTION_HINTS = {
	"min-quantity-exceeded":
		"The order is too small. Raise the quantity to at least `error.minQuantity`, the smallest Trading 212 accepts for it.",
	"max-quantity-exceeded":
		"The order is too large for one order. Split it into orders of at most `error.maxQuantity` each.",
	"insufficient-free-for-stocks-buy":
		"Not enough free cash for this buy. Check `cash.availableToTrade` in `account.summary()`; cash reserved for pending orders or held in pies does not count.",
	"selling-equity-not-owned":
		"You are selling more than is available. Shares held in pies or reserved by pending orders do not count: check `quantityAvailableForTrading` on the position, or use `orders.sellAll(ticker)`.",
	"market-closed":
		"The market for this instrument is closed. `exchanges.status(ticker)` shows its current session and when it next opens.",
	"quantity-precision-mismatch":
		"Quantities allow at most 4 decimal places. Use `truncateQuantity(quantity)` to round down safely.",
} as const;

const NOT_FOUND_HINTS: Partial<Record<string, string>> = {
	getOrder:
		"The order is not pending any more: it may have filled, been cancelled or never existed. Filled and cancelled orders are in `history.orders.list()`.",
	cancelOrder:
		"The order is not pending any more, so there is nothing to cancel: it may already have filled or been cancelled.",
	getPie: "No pie has that ID. `pies.list()` shows the ones that exist.",
	deletePie: "No pie has that ID. `pies.list()` shows the ones that exist.",
	updatePie: "No pie has that ID. `pies.list()` shows the ones that exist.",
	duplicatePie: "No pie has that ID. `pies.list()` shows the ones that exist.",
};

export function notFoundHint(endpoint: string | undefined): string {
	return (endpoint && NOT_FOUND_HINTS[endpoint]) ?? "Trading 212 has nothing at that address.";
}
