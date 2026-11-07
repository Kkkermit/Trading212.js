# Testing your code

## The fake Trading 212

`createFakeTrading212()` returns a real `Trading212` client whose `fetch` is an in-memory Trading 212, so your code
runs exactly as it would against the API: validation, errors, pagination, the live-trading switch and all. No network,
no key, and rate limiting is off so tests run instantly.

```ts
import { createFakeTrading212 } from "@kkermit/trading212.js/testing";

const { client, server } = createFakeTrading212({
	state: {
		cash: 5000,
		currency: "GBP",
		prices: { AAPL_US_EQ: 200 },
		positions: [{ ticker: "MSFT_US_EQ", quantity: 3, averagePrice: 380, inPies: 1 }],
		dividends: [{ ticker: "MSFT_US_EQ", amount: 2.1, paidOn: "2026-06-12T00:00:00Z" }],
	},
});
```

What it does:

- **Market orders fill at once** at the current price, moving cash and positions and writing history.
- **Limit and stop orders wait** until you call `server.fill(orderId, price?)`. Their cash or shares are reserved.
- **It refuses what Trading 212 refuses:** not enough cash, selling more than available, more than 4 decimal places,
  `extendedHours` on a non-market order, an unknown ticker, a closed market (`server.marketOpen = false`) and the
  wrong key.
- **History is paginated** with `nextPagePath`, like the real API.
- **CSV exports are refused on demo**, like the real API. Use `environment: "live"` or `server.exportsOnDemo = true`
  to test them. It checks your code sends no credentials to the download link.

Controls and state:

```ts
server.setPrice("AAPL_US_EQ", 250);
server.failNext("placeMarketOrder", { status: 400, body: { code: "MarketClosed" } });
server.failNext("getAccountSummary", { network: "ECONNRESET" });
server.position("AAPL_US_EQ"); // as the API would return it
server.cash;
server.requests; // every request, without credentials
```

A live fake has trading enabled unless you say otherwise, so you can test the switch:

```ts
const { client } = createFakeTrading212({ environment: "live", client: { trading: "disabled" } });
await expect(client.orders.buy(order)).rejects.toBeInstanceOf(TradingDisabledError);
```

The fake does not do FX, fees or partial fills, and its market hours are a simple weekday schedule.

## Scripted fetch

For testing at the HTTP level, `scriptedFetch()` answers from a list, in order, and records every request:

```ts
import { networkError, scriptedFetch } from "@kkermit/trading212.js/testing";

const { fetch, requests } = scriptedFetch([
	{ status: 503 },
	{ body: { id: 1, currency: "GBP" }, headers: { "x-ratelimit-remaining": "0" } },
	(request) => ({ status: 200, body: { echoed: request.query } }),
	networkError("ECONNREFUSED"),
]);
const t212 = new Trading212({ environment: "demo", apiKey: "k-test", apiSecret: "s-test", fetch, rateLimit: "off" });
```

## Contract tests against demo

This repository's own `tests/contract` suite runs against the real demo API with `npm run test:demo` when
`T212_DEMO_API_KEY` and `T212_DEMO_API_SECRET` are set. It never touches live.
