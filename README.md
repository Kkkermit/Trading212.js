# trading212.js

A TypeScript client for the [Trading 212 Public API](https://docs.trading212.com/api) that is safe around real
money, tells you how to fix what went wrong, and comes with a fake Trading 212 to test your code against.

```ts
import { Trading212 } from "@kkermit/trading212.js";

const t212 = new Trading212({ environment: "demo", apiKey, apiSecret });

const { totalValue, holdings } = await t212.portfolio.snapshot();
const apple = await t212.instruments.resolve("Apple");
const order = await t212.orders.buy({ ticker: apple.ticker!, quantity: 0.5 });
await t212.orders.waitFor(order); // FILLED
```

> [!WARNING]
> **Unofficial.** Not affiliated with or endorsed by Trading 212. The API is in beta and can change. Live trading
> uses real money: test on demo first, and read [Safety](#safety-around-real-money).

## Why this one

- **A live client cannot trade by accident.** It only reads until you pass `trading: "enabled"`. Orders are never
  retried, a request that may or may not have executed throws `OrderOutcomeUnknownError` rather than a plain
  failure, and `{ dryRun: true }` shows the exact request without sending it.
- **Errors tell you what to do.** Every error is a named class with a `hint` in plain English. A 403 names the
  permission your key lacks. A 401 explains that demo keys do not work on live. `SellingEquityNotOwned` points you
  at the shares locked in pies.
- **Your key stays secret.** Credentials are redacted from every log line, error, hook event and test recording,
  and a test suite proves it by echoing them back from a hostile server. Redirects are refused, pagination links
  are pinned to Trading 212's host, and signed download links never receive your key.
- **Rate limits are handled.** Every endpoint has its own budget, generated from the official spec, corrected from
  the response headers, and shared by every client for the same account in your process. Calls are paced the way
  Trading 212 recommends, so you should not see a 429.
- **Whole jobs, not just endpoints.** Turn "Apple" into `AAPL_US_EQ`, sell a whole position without the
  4-decimal-place error, wait for an order to fill, export a year of history as CSV in one call, check whether a
  market is open, and get your portfolio's weights and profit in one call.
- **Test without the network.** `createFakeTrading212()` gives you the real client talking to an in-memory Trading
  212 that fills orders, tracks cash and positions, paginates history, and fails on demand.
- **`npx @kkermit/trading212.js doctor`** checks your key, environment and every permission in one go.
- **Small and modern.** Zero runtime dependencies, about 13 kB minified and compressed, ESM and CommonJS, full types.
  Works on Node 22+, Bun and Deno.

### How it compares

There are several community clients for this API on npm, all young. When this library was written (November
2026), none of the ones reviewed shipped a fake server for tests, a command-line check, or errors that name the
missing permission and say how to fix it. Several have runtime dependencies. Compare for yourself:
`trading212-api`, `t212-sdk`, `@mingchuno/trading212-client` and `@azaini/t212-sdk` are the main ones.

## Install

```sh
npm install @kkermit/trading212.js
```

Node 22 or later, Bun or Deno. Server-side only: Trading 212 refuses requests from web pages, and a key in a page is
public, so the client refuses to start in a browser.

## Get a key

In the Trading 212 app, go to **Settings → API (Beta)** and create a key. You will see the secret **once**, so save
it straight into your secret manager.

- **A key works in one environment only.** Make a demo key while the app is in practice mode, and a separate one
  for live.
- **Tick only the permissions you need.** A dashboard needs no `orders:execute`.
- **Restrict the key to your server's IP address** if it runs somewhere fixed.
- Only **Invest** and **Stocks ISA** accounts can use the API.

Then check it:

```sh
T212_ENV=demo T212_API_KEY=... T212_API_SECRET=... npx @kkermit/trading212.js doctor
```

```
✓ settings: environment demo, key 37 characters, secret 43 characters
✓ sign in: account 12345678 (GBP) on demo
✓ portfolio: allowed
✗ history:dividends: not on this key (create one with "history:dividends" ticked)
· exports: live only
· orders:execute: not checked: it would need a real order
✓ trading: orders can be placed on demo
```

## Quick start

```ts
import { Trading212 } from "@kkermit/trading212.js";

// Reads T212_ENV, T212_API_KEY and T212_API_SECRET. There is no default environment, on purpose.
const t212 = Trading212.fromEnv();

const me = await t212.verify(); // { environment, accountId, currency, trading }
const positions = await t212.positions.list();

for await (const dividend of t212.history.dividends.all()) {
	console.log(dividend.paidOn, dividend.ticker, dividend.amount);
}
```

Every part of the API is covered: `account`, `positions`, `instruments`, `exchanges`, `orders`, `history`
(orders, dividends and transactions), `reports` (CSV exports) and the deprecated `pies`. See the
[guides](#guides) for each.

## Safety around real money

```ts
// A live client reads, but refuses every order before anything is sent.
const reader = new Trading212({ environment: "live", apiKey, apiSecret });
await reader.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 }); // throws TradingDisabledError

// Preview exactly what would be sent, on any client.
const preview = await reader.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 }, { dryRun: true });
// { dryRun: true, url: "https://live.trading212.com/api/v0/equity/orders/market", body: {...}, wouldSend: false }

// Trading on live is a deliberate choice.
const trader = new Trading212({ environment: "live", apiKey, apiSecret, trading: "enabled" });
```

- **Orders are never retried.** Reads are, with backoff.
- **If an order may have executed** (a timeout, a dropped connection, a 5xx), you get `OrderOutcomeUnknownError`.
  Check `orders.list()` and `history.orders.list()` before trying again. If the connection never opened (DNS failure,
  connection refused), you get a `NetworkError` with `sent: false` instead, and it is safe to retry.
- **`buy()` and `sell()` take a positive quantity** and set the sign themselves, so a stray minus sign cannot turn a
  sale into a purchase. The low-level `market()`, `limit()`, `stop()` and `stopLimit()` follow the API's
  convention, where a negative quantity sells.
- **Orders are checked before sending:** a ticker without spaces, at most 4 decimal places, a positive price,
  `timeValidity` stated, and `extendedHours` on market orders only. Every problem is reported at once.

## Errors

Every error extends `Trading212Error`, with `code`, `hint`, `status`, `request`, `rateLimit`, the redacted `body`
and Trading 212's own `apiCode`. `instanceof` works even if two copies of the package are loaded.

| Error                      | When                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `ConfigurationError`       | Bad options or environment variables. Nothing was sent        |
| `AuthenticationError`      | 401: wrong key or secret, or a key from the other environment |
| `MissingScopeError`        | 403: the key lacks `error.scope`, such as `orders:execute`    |
| `NotAvailableInDemoError`  | 403: live-only features, such as CSV exports                  |
| `PermissionError`          | Any other 403, such as an IP restriction                      |
| `ValidationError`          | Invalid request, before sending (`error.issues`) or a 400     |
| `OrderRejectedError`       | A refused order, with `error.reason`                          |
| `NotFoundError`            | 404                                                           |
| `InstrumentNotFoundError`  | `resolve()` found none or several, with `error.suggestions`   |
| `RateLimitError`           | 429, with `retryAfterMs` and `resetAt`                        |
| `TimeoutError`             | 408, or no answer within `timeoutMs`                          |
| `OrderOutcomeUnknownError` | An order may or may not have executed                         |
| `TradingDisabledError`     | An order on live without `trading: "enabled"`                 |
| `NetworkError`             | The connection failed; `sent` says whether it left            |
| `ServerError`              | 5xx                                                           |

```ts
import { isTrading212Error, MissingScopeError } from "@kkermit/trading212.js";

try {
	await t212.orders.sellAll("AAPL_US_EQ");
} catch (error) {
	if (error instanceof MissingScopeError) console.error(`Missing ${error.scope}: ${error.hint}`);
	else if (isTrading212Error(error))
		logger.error(error.message, error.toLog()); // safe to log as-is
	else throw error;
}
```

## Logging and hooks

The client is silent by default. Give it a logger to see every request, retry and rate-limit wait. Every field is
redacted first.

```ts
import { consoleLogger, fieldsFirst } from "@kkermit/trading212.js";

new Trading212({ ...options, logger: consoleLogger({ level: "debug" }) });
new Trading212({ ...options, logger: fieldsFirst(pino()) }); // pino and bunyan take (fields, message)
new Trading212({
	...options,
	hooks: { onResponse: ({ endpoint, status, durationMs }) => metrics.observe(endpoint, durationMs) },
});
```

## Testing your code

```ts
import { createFakeTrading212 } from "@kkermit/trading212.js/testing";

const { client, server } = createFakeTrading212({
	state: { cash: 1000, positions: [{ ticker: "AAPL_US_EQ", quantity: 2 }] },
});

await client.orders.sell({ ticker: "AAPL_US_EQ", quantity: 1 });
expect(server.position("AAPL_US_EQ")?.quantity).toBe(1);

server.marketOpen = false; // the next order is refused with MarketClosed
server.failNext("getAccountSummary", { status: 503 }); // or { network: "ECONNRESET" }
```

`scriptedFetch()` is there too, for testing at the HTTP level.

## Guides

- [Getting started](docs/getting-started.md): keys, environments, the doctor, configuration
- [Orders](docs/orders.md): order types, quantities, `sellAll`, `waitFor`, dry runs
- [Data](docs/data.md): instruments and tickers, market hours, history and pagination, reports, portfolio
- [Errors](docs/errors.md): every error, what causes it and how to fix it
- [Rate limits](docs/rate-limits.md): budgets, pacing, sharing between clients and processes
- [Logging and hooks](docs/logging.md)
- [Testing](docs/testing.md): the fake server and scripted fetch
- [Safety and security](docs/safety.md)

## Status

Version 0.x while the API is in beta. Types and endpoint metadata are generated from Trading 212's OpenAPI spec, and
a weekly job checks for changes. A few behaviours the spec does not document (error body shapes, demo-only
refusals) are handled defensively and checked against the real demo API by the contract tests in
`tests/contract`.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE). "Trading 212" is a trademark of its owner, used here only to say what this library talks to.
