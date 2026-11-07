# Data

All amounts are in the account's **primary currency**: the API does not support multi-currency accounts. Prices of
UK instruments quoted in GBX are in pence. Every field in a response is typed as optional, because the API omits
fields freely.

## Account and portfolio

```ts
const summary = await t212.account.summary(); // cash, investments, totalValue, currency, id
const snapshot = await t212.portfolio.snapshot();
// { currency, totalValue, cash, invested, unrealisedProfitLoss, realisedProfitLoss,
//   holdings: [{ ticker, name, quantity, value, cost, profitLoss, profitLossRatio, weight }], takenAt }
```

`snapshot()` makes two requests and sorts holdings largest first. `buildPortfolioSnapshot(summary, positions)` does the
same from data you already have.

## Positions

```ts
const all = await t212.positions.list();
const apple = await t212.positions.get("AAPL_US_EQ"); // undefined if you hold none
apple?.quantityAvailableForTrading; // excludes shares in pies and reserved by pending orders
```

## Instruments and tickers

Tickers are Trading 212's own: `AAPL_US_EQ`, `VODl_EQ` (a lowercase `l` means London), `SXR8d_EQ` (`d` means
Germany). Do not build them by hand; look them up.

```ts
const results = await t212.instruments.search("vanguard s&p", { type: "ETF", limit: 5 });
const apple = await t212.instruments.resolve("AAPL", { currency: "USD" }); // exactly one, or InstrumentNotFoundError
const exact = await t212.instruments.find("AAPL_US_EQ"); // or undefined
```

`resolve()` accepts an exact ticker, ISIN, short name or full name. If nothing matches exactly, or several do, it
throws `InstrumentNotFoundError` with `suggestions` and a hint on narrowing it with `currency` or `type`.

The full list is about 5 MB and limited to one request every 50 seconds, so it is cached (one hour by default) and
concurrent callers share a single download. Trading 212 refreshes it every 10 minutes. To share the cache between
processes, pass a `cache` that implements `get`, `set` and optionally `delete`:

```ts
const redisCache = {
	get: async (key: string) => JSON.parse((await redis.get(key)) ?? "null") ?? undefined,
	set: (key: string, value: unknown, ttlMs: number) => redis.set(key, JSON.stringify(value), "PX", ttlMs),
};
new Trading212({ ...options, cache: redisCache });
```

## Market hours

```ts
const status = await t212.exchanges.status("AAPL_US_EQ");
// { session: "regular" | "preMarket" | "afterHours" | "overnight" | "closed" | "unknown",
//   open, extendedHours, since, next: { event, at }, nextOpen, exchange }
```

This reads Trading 212's working schedules, which cover a limited window ahead, so `nextOpen` can be undefined. During a
midday break, `nextOpen` is the end of the break.
`sessionAt(timeEvents, date)` is the same calculation as a pure function. Treat it as guidance: Trading 212 makes
the final decision, and refuses with `MarketClosed`.

## History and pagination

```ts
// One page (newest first), up to 50 items:
const page = await t212.history.orders.list({ ticker: "AAPL_US_EQ", limit: 50 });
page.items; // [{ order, fill }]
const next = await page.next(); // or null on the last page
const later = await t212.history.orders.list({ cursor: page.nextCursor! }); // resume any time

// Everything, fetching pages as you go:
for await (const { order, fill } of t212.history.orders.all()) console.log(order?.ticker, fill?.price);
const dividends = await Array.fromAsync(t212.history.dividends.all({ maxItems: 500 }));
```

The same applies to `history.dividends` and `history.transactions` (deposits, withdrawals, fees, transfers and
interest). `all()` takes `pageSize` (default 50, the fewest requests), `maxPages` and `maxItems`. If a page fails
part-way through, the error carries `resumeCursor` for picking up where it stopped.

Each history endpoint allows 20 requests a minute, so a long history takes a while; the client paces itself rather
than hitting the limit. `nextPagePath` from Trading 212 is followed only if it points back at the same endpoint on
the same host.

## CSV reports (live only)

```ts
const { report, csv } = await t212.reports.export({ from: "2026-01-01", to: "2026-12-31" });

// or step by step:
const id = await t212.reports.request({ from, to, include: { interest: false } });
const ready = await t212.reports.waitFor(id, { onStatus: (r) => console.log(r.status) });
const text = await t212.reports.download(ready);
```

Listing reports is limited to once a minute, so `export()` takes at least a minute. Downloads go to a signed link
**without** your credentials. Trading 212 may notify the account's app of each export. On demo, every export call
throws `NotAvailableInDemoError`.

Parse the CSV with the small parser in its own entry point:

```ts
import { csvNumber, parseCsv } from "@kkermit/trading212.js/csv";

for (const row of parseCsv(text)) console.log(row.Action, row.Ticker, csvNumber(row.Total));
```

## Pies (deprecated)

`t212.pies.list()`, `get()`, `create()`, `update()`, `delete()` and `duplicate()` still work, but Trading 212 has
deprecated them and may remove them. The first call logs a warning. Changing a pie counts as trading, so a live
client needs `trading: "enabled"`.
