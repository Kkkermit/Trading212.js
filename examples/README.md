# Examples

Each file is a complete program. Run them from a clone of the repository, after `npm ci`.

## Without a key

```sh
npm run example examples/try-it-offline.ts
```

This one talks to the fake Trading 212 in `@kkkermit/trading212.js/testing`, so it needs no key and no network. It
signs in, resolves "Apple" to a ticker, previews and places an order, waits for the fill and shows a refusal with its
hint.

`testing-your-bot.test.ts` shows how to test your own code the same way. It runs with `npm test`.

## With a demo key

Copy `.env.example` to `.env`, set `T212_ENV=demo` and paste a demo key and secret, then:

```sh
npm run example -- --env-file=.env examples/portfolio-snapshot.ts
```

| File                       | What it does                                                                  |
| -------------------------- | ----------------------------------------------------------------------------- |
| `portfolio-snapshot.ts`    | Prints the account's total, cash, and each holding's value, weight and profit |
| `place-an-order-safely.ts` | Finds an instrument, checks its market is open, previews, buys and waits      |
| `dividends-by-ticker.ts`   | Walks the whole dividend history and totals it by ticker                      |
| `logging-and-metrics.ts`   | Logs to the console and counts requests with hooks                            |
| `export-csv.ts`            | Exports a year of history as CSV and parses it. Live accounts only            |

`place-an-order-safely.ts` places a real order on whichever environment `T212_ENV` names. On demo that is practice
money; on live it is refused unless you change the example to pass `trading: "enabled"`.
