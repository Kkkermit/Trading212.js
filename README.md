<h1><img src="docs/public/logo.svg" alt="trading212.js" height="64"></h1>

[![CI](https://github.com/Kkkermit/Trading212.js/actions/workflows/ci.yml/badge.svg)](https://github.com/Kkkermit/Trading212.js/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kkkermit/trading212.js)](https://www.npmjs.com/package/@kkkermit/trading212.js)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)

A TypeScript client for the [Trading 212 Public API](https://docs.trading212.com/api) that is safe around real
money, tells you how to fix what went wrong, and comes with a fake Trading 212 to test your code against.

```ts
import { Trading212 } from "@kkkermit/trading212.js";

const t212 = new Trading212({ environment: "demo", apiKey, apiSecret });

const { totalValue, holdings } = await t212.portfolio.snapshot();
const apple = await t212.instruments.resolve("Apple");
const order = await t212.orders.buy({ ticker: apple.ticker, quantity: 0.5 });
await t212.orders.waitFor(order); // FILLED
```

> [!WARNING]
> **Unofficial.** Not affiliated with or endorsed by Trading 212. The API is in beta and can change. Live trading
> uses real money: test on demo first, and read [Safety](#safety-around-real-money).

## Why this one

- **A live client cannot trade by accident.** It only reads until you pass `trading: "enabled"`, and so does any
  client pointed at a custom `baseUrl`, because a proxy could forward to live. Orders are never
  retried, a request that may or may not have executed throws `OrderOutcomeUnknownError` rather than a plain
  failure, and `{ dryRun: true }` shows the exact request without sending it.
- **Errors tell you what to do.** Every error is a named class with a `hint` in plain English. A 403 names the
  permission your key lacks. A 401 explains that demo keys do not work on live. An order that is too small says
  so, and one selling more than you hold points you at the shares locked in pies.
- **Your key stays secret.** Credentials are redacted from every log line, error, hook event and test recording,
  and a test suite proves it by echoing them back from a hostile server. Redirects are refused, pagination links
  are pinned to Trading 212's host, and signed download links never receive your key.
- **Rate limits are handled.** Every endpoint has its own budget, generated from the official spec, corrected from
  the response headers, and shared by every client using the same key in your process. Calls are paced the way
  Trading 212 recommends, so you should not see a 429.
- **Common tasks take one call.** Turn "Apple" into `AAPL_US_EQ`, sell a whole position without the
  4-decimal-place error, wait for an order to fill, export a year of history as CSV in one call, check whether a
  market is open, and get your portfolio's weights and profit in one call.
- **Test without the network.** `createFakeTrading212()` gives you the real client talking to an in-memory Trading
  212 that fills orders, tracks cash and positions, paginates history, and fails on demand.
- **`npx @kkkermit/trading212.js doctor`** checks your key, environment and every permission in one go.
- **Small and modern.** Zero runtime dependencies, about 14 kB minified and compressed, ESM and CommonJS, full types.
  Works on Node 22+, Bun and Deno.

### How it compares

There are several community clients for this API on npm, all young. When this library was written (November
2026), none of the ones reviewed shipped a fake server for tests, a command-line check, or errors that name the
missing permission and say how to fix it. Several have runtime dependencies. Compare for yourself:
`trading212-api`, `t212-sdk`, `@mingchuno/trading212-client` and `@azaini/t212-sdk` are the main ones.

## Install

```sh
npm install @kkkermit/trading212.js
```

Node 22 or later, Bun or Deno. Server-side only: Trading 212 refuses requests from web pages, and a key in a page is
public, so the client refuses to start in a browser.

New to it? [Getting started](https://kkkermit.github.io/Trading212.js/getting-started/) goes from install to a working script step by step,
starting with a try-out that needs no key. The [examples](examples) are complete programs.

## Get a key

In the Trading 212 app, go to **Settings > API (Beta)** and create a key. You will see the secret **once**, so save
it straight into your secret manager.

- **A key works in one environment only.** Make a demo key while the app is in practice mode, and a separate one
  for live.
- **Tick only the permissions you need.** A dashboard needs no `orders:execute`.
- **Restrict the key to your server's IP address** if it runs somewhere fixed.
- Only **Invest** and **Stocks ISA** accounts can use the API.

Then check it:

```sh
T212_ENV=demo T212_API_KEY=... T212_API_SECRET=... npx @kkkermit/trading212.js doctor
```

The output looks like this:

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
import { Trading212 } from "@kkkermit/trading212.js";

// Reads T212_ENV, T212_API_KEY and T212_API_SECRET. There is no default environment, on purpose.
const t212 = Trading212.fromEnv();

const me = await t212.verify(); // { environment, accountId, currency, trading }
const positions = await t212.positions.list();

for await (const dividend of t212.history.dividends.all()) {
	console.log(dividend.paidOn, dividend.ticker, dividend.amount);
}
```

## What it covers

Every one of the 22 operations in Trading 212's Public API, on both of its environments. A test fails the build if
the official spec gains an operation this library does not implement.

| Environment | Host                          | What it is                                               |
| ----------- | ----------------------------- | -------------------------------------------------------- |
| `demo`      | `https://demo.trading212.com` | Paper trading with practice money. Trading is on.        |
| `live`      | `https://live.trading212.com` | Your real account ("prod"). No trading until you opt in. |

There is no third environment: "production" and "real" mean `live`, and "paper", "practice" and "sandbox" mean
`demo`. The client asks you to name one of the two and never guesses.

| Method                                             | Endpoint                           | Permission             | Limit    |
| -------------------------------------------------- | ---------------------------------- | ---------------------- | -------- |
| `account.summary()`                                | `GET /equity/account/summary`      | `account`              | 1 / 5 s  |
| `positions.list()`, `positions.get()`              | `GET /equity/positions`            | `portfolio`            | 1 / 1 s  |
| `instruments.list()`, `search()`, `resolve()`      | `GET /equity/metadata/instruments` | `metadata`             | 1 / 50 s |
| `exchanges.list()`, `exchanges.status()`           | `GET /equity/metadata/exchanges`   | `metadata`             | 1 / 30 s |
| `orders.list()`                                    | `GET /equity/orders`               | `orders:read`          | 1 / 5 s  |
| `orders.get()`, `orders.waitFor()`¹                | `GET /equity/orders/{id}`          | `orders:read`          | 1 / 1 s  |
| `orders.cancel()`                                  | `DELETE /equity/orders/{id}`       | `orders:execute`       | 50 / min |
| `orders.market()`, `buy()`, `sell()`, `sellAll()`² | `POST /equity/orders/market`       | `orders:execute`       | 50 / min |
| `orders.limit()`                                   | `POST /equity/orders/limit`        | `orders:execute`       | 1 / 2 s  |
| `orders.stop()`                                    | `POST /equity/orders/stop`         | `orders:execute`       | 1 / 2 s  |
| `orders.stopLimit()`                               | `POST /equity/orders/stop_limit`   | `orders:execute`       | 1 / 2 s  |
| `history.orders.list()`, `.all()`                  | `GET /equity/history/orders`       | `history:orders`       | 20 / min |
| `history.dividends.list()`, `.all()`               | `GET /equity/history/dividends`    | `history:dividends`    | 20 / min |
| `history.transactions.list()`, `.all()`            | `GET /equity/history/transactions` | `history:transactions` | 20 / min |
| `reports.list()`, `reports.waitFor()`              | `GET /equity/history/exports`      | not stated in the spec | 1 / min  |
| `reports.request()`, `reports.export()`            | `POST /equity/history/exports`     | not stated in the spec | 1 / 30 s |
| `pies.list()`                                      | `GET /equity/pies`                 | `pies:read`            | 1 / 30 s |
| `pies.get()`                                       | `GET /equity/pies/{id}`            | `pies:read`            | 1 / 5 s  |
| `pies.create()`                                    | `POST /equity/pies`                | `pies:write`           | 1 / 5 s  |
| `pies.update()`                                    | `POST /equity/pies/{id}`           | `pies:write`           | 1 / 5 s  |
| `pies.duplicate()`                                 | `POST /equity/pies/{id}/duplicate` | `pies:write`           | 1 / 5 s  |
| `pies.delete()`                                    | `DELETE /equity/pies/{id}`         | `pies:write`           | 1 / 5 s  |

¹ Also needs `history:orders`, to find the order once it has left the pending list. ² `sellAll()` also needs
`portfolio`, to read the position.

Paths are under `/api/v0`. `portfolio.snapshot()` combines the account summary and positions. CSV exports are
live only: demo refuses them, as the contract tests confirm. Trading 212 has deprecated the pie
endpoints, which still work. The exported `ENDPOINTS` table holds the same facts at run time. See the
[documentation](#documentation) for each part.

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
import { isTrading212Error, MissingScopeError } from "@kkkermit/trading212.js";

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

The client is silent by default. Give it a logger and it writes one line per event: every order at `info`, every
read at `debug`, and retries, long rate-limit waits and orders with an unknown outcome at `warn`. Every field is
redacted first.

```ts
import { consoleLogger, fieldsFirst } from "@kkkermit/trading212.js";

new Trading212({ ...options, logger: consoleLogger({ level: "info" }) });
// [trading212] INFO  POST /api/v0/equity/orders/market returned 200 in 212 ms endpoint=placeMarketOrder status=200 …
new Trading212({ ...options, logger: fieldsFirst(pino()) }); // pino and bunyan take (fields, message)
new Trading212({
	...options,
	hooks: { onResponse: ({ endpoint, status, durationMs }) => metrics.observe(endpoint, durationMs) },
});
```

## Testing your code

```ts
import { createFakeTrading212 } from "@kkkermit/trading212.js/testing";

const { client, server } = createFakeTrading212({
	state: { cash: 1000, positions: [{ ticker: "AAPL_US_EQ", quantity: 2 }] },
});

await client.orders.sell({ ticker: "AAPL_US_EQ", quantity: 1 });
expect(server.position("AAPL_US_EQ")?.quantity).toBe(1);

server.marketOpen = false; // the next order is refused with market-closed
server.failNext("getAccountSummary", { status: 503 }); // or { network: "ECONNRESET" }
```

`scriptedFetch()` is there too, for testing at the HTTP level.

## Documentation

The full documentation is at **[kkkermit.github.io/Trading212.js](https://kkkermit.github.io/Trading212.js/)**. Its source is the MDX in
[`docs/src/content/docs`](docs/src/content/docs).

- [Getting started](https://kkkermit.github.io/Trading212.js/getting-started/): install, keys, the doctor and a first script
- [Key concepts](https://kkkermit.github.io/Trading212.js/concepts/) and [your first program](https://kkkermit.github.io/Trading212.js/tutorial/), for beginners
- [Recipes](https://kkkermit.github.io/Trading212.js/recipes/): complete programs for common tasks, in TypeScript and JavaScript
- [API coverage](https://kkkermit.github.io/Trading212.js/reference/api-coverage/): every endpoint, its method, permission and limit
- [Orders](https://kkkermit.github.io/Trading212.js/guides/orders/): order types, quantities, `sellAll`, `waitFor`, dry runs
- [Instruments and market hours](https://kkkermit.github.io/Trading212.js/guides/instruments-and-markets/), [history](https://kkkermit.github.io/Trading212.js/guides/history/),
  [CSV reports](https://kkkermit.github.io/Trading212.js/guides/reports/) and the [portfolio](https://kkkermit.github.io/Trading212.js/guides/account-and-portfolio/)
- [Errors](https://kkkermit.github.io/Trading212.js/guides/errors/): every error, what causes it and how to fix it
- [Rate limits](https://kkkermit.github.io/Trading212.js/guides/rate-limits/), [logging and hooks](https://kkkermit.github.io/Trading212.js/guides/logging/) and
  [configuration](https://kkkermit.github.io/Trading212.js/reference/configuration/)
- [Testing your code](https://kkkermit.github.io/Trading212.js/guides/testing/): the fake server and scripted fetch
- [Safety and security](https://kkkermit.github.io/Trading212.js/guides/safety/)
- The [reference](https://kkkermit.github.io/Trading212.js/reference/client/): every method, option, helper, error and type
- [FAQ and troubleshooting](https://kkkermit.github.io/Trading212.js/help/faq/)

## Status

Version 0.x while the API is in beta. Types and endpoint metadata are generated from Trading 212's OpenAPI spec, and
a weekly job checks for changes. The spec does not document error bodies, so the ones demo really sends are recorded in
`fixtures/errors.json` and replayed by the tests; the few refusals not seen there yet are handled defensively. The
contract tests in `tests/contract` check the rest against demo when run with a demo key.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md), and follow the [code of conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE). "Trading 212" is a trademark of its owner, used here only to say what this library talks to.
