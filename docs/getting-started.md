# Getting started

From nothing to a working script in six steps. Steps 1 and 2 need no Trading 212 account at all.

## 1. Install

```sh
npm install @kkermit/trading212.js   # or: pnpm add, yarn add, bun add
```

You need Node 22 or later, Bun, or Deno (`import { Trading212 } from "npm:@kkermit/trading212.js"`). The library
runs on servers only: Trading 212 refuses requests from web pages, and a key shipped to a browser is public.

## 2. Try it without a key

The fake Trading 212 in `@kkermit/trading212.js/testing` is the real client talking to an in-memory account, so
you can see how everything behaves before making a key. Save this as `try.mjs` and run `node try.mjs`:

```js
import { createFakeTrading212 } from "@kkermit/trading212.js/testing";

const { client } = createFakeTrading212({ state: { cash: 1000 } });

const apple = await client.instruments.resolve("Apple");
const order = await client.orders.buy({ ticker: apple.ticker, quantity: 2 });
console.log(await client.orders.waitFor(order)); // status: "FILLED"
console.log(await client.portfolio.snapshot());
```

The same thing, with a refusal and its hint, is in
[`examples/try-it-offline.ts`](../examples/try-it-offline.ts).

## 3. Make a key

In the Trading 212 app, open **Settings > API (Beta)** and generate a key.

- Choose the environment first. A key made in practice mode works on **demo** only; one made with real money works on
  **live** only. Using the wrong one gives `AuthenticationError`, whose hint says exactly this. There are only these
  two environments: "production" is live, and "paper" or "sandbox" is demo.
- Tick only the permissions the program needs:

  | Permission             | Lets the key                                  |
  | ---------------------- | --------------------------------------------- |
  | `account`              | read the account summary (needed by `verify`) |
  | `portfolio`            | read positions (needed by `sellAll`)          |
  | `metadata`             | read instruments and exchanges                |
  | `orders:read`          | read pending orders                           |
  | `orders:execute`       | place and cancel orders                       |
  | `history:orders`       | read order history (needed by `waitFor`)      |
  | `history:dividends`    | read dividends                                |
  | `history:transactions` | read deposits, withdrawals, fees and interest |
  | `pies:read`            | read pies (deprecated)                        |
  | `pies:write`           | change pies (deprecated)                      |

- The secret is shown once. Copy it straight into the next step.
- Optionally restrict the key to fixed IP addresses.

## 4. Store it

Make a `.env` file next to your code, and make sure git ignores it:

```sh
T212_ENV=demo
T212_API_KEY=your-key
T212_API_SECRET=your-secret
```

```sh
echo .env >> .gitignore
```

If you keep a key per environment, set `T212_DEMO_API_KEY` / `T212_DEMO_API_SECRET` and `T212_LIVE_API_KEY` /
`T212_LIVE_API_SECRET` instead, and switch with `T212_ENV`. The library never reads `.env` itself; the runtime
loads it, as below.

## 5. Check it

```sh
npx @kkermit/trading212.js doctor --env-file .env
```

The doctor signs in, then tries one read for each permission and reports which are missing. It never prints your
key or secret, and never places an order. `--json` prints the result for scripts.

## 6. Write your first script

```js
// app.mjs
import { Trading212 } from "@kkermit/trading212.js";

const t212 = Trading212.fromEnv();
console.log(await t212.verify()); // { environment, accountId, currency, trading }
console.log(await t212.portfolio.snapshot());
```

```sh
node --env-file=.env app.mjs
```

| Your project | Do this                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| ES modules   | As above: a `.mjs` file, or `"type": "module"` in `package.json`                       |
| CommonJS     | `const { Trading212 } = require("@kkermit/trading212.js")`, inside an `async` function |
| TypeScript   | Types are included. Run with `npx tsx --env-file=.env app.ts`, or compile with `tsc`   |
| Bun          | `bun app.ts`; Bun loads `.env` by itself                                               |
| Deno         | `deno run --allow-net --allow-env --env-file=.env app.ts`, importing from `npm:`       |

You can also pass the options yourself instead of using `fromEnv()`:

```ts
const t212 = new Trading212({
	environment: "demo",
	apiKey: process.env.T212_API_KEY ?? "",
	apiSecret: process.env.T212_API_SECRET ?? "",
});
```

**There is no default environment.** Trading 212's own guide defaults to live and other libraries default to demo.
When guesses disagree, guessing is the bug.

## Going live

Make a second key in real-money mode, set `T212_ENV=live`, and run the doctor again. A live client only reads:
orders, cancellations and pie changes throw `TradingDisabledError` until you pass `trading: "enabled"`.

```ts
const t212 = Trading212.fromEnv({ trading: "enabled" });
```

Read [Safety and security](safety.md) first.

## Options

| Option                   | Default                                                   | What it does                                                      |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `environment`            | required                                                  | `"demo"` or `"live"`                                              |
| `apiKey`, `apiSecret`    | required                                                  | Checked for whitespace, swaps and other copy-paste slips          |
| `trading`                | enabled on Trading 212's demo host, otherwise disabled    | Whether orders, cancellations and pie changes may be sent         |
| `timeoutMs`              | `15000`                                                   | Per request; override per call with `{ timeoutMs }`               |
| `retry`                  | `{ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000 }` | Reads only; `false` turns it off                                  |
| `rateLimit`              | `"pace"`                                                  | `"pace"`, `"burst"` or `"off"`; see [Rate limits](rate-limits.md) |
| `maxRateLimitWaitMs`     | `60000`                                                   | Throw `RateLimitError` rather than wait longer than this          |
| `logger`                 | silent                                                    | See [Logging](logging.md)                                         |
| `hooks`                  | none                                                      | `onRequest`, `onResponse`, `onRetry`, `onRateLimitWait`           |
| `cache`, `metadataTtlMs` | memory, 1 hour                                            | Where the instrument and exchange lists are kept                  |
| `fetch`                  | global `fetch`                                            | For proxies, tracing and tests                                    |
| `baseUrl`                | Trading 212                                               | Tests and proxies only; must be `https://` or `http://localhost`  |
| `userAgent`              | `trading212.js/<version>`                                 | Appended to the user agent                                        |

Every method also takes `{ signal }` to cancel it, and most take `{ timeoutMs }`. The instrument and exchange lists
take only `signal`: one download is shared by every caller, so it uses the client's own timeout.

## Where next

- [Orders](orders.md) to place your first demo trade.
- [Data](data.md) for instruments, history, reports and the portfolio snapshot.
- [Errors](errors.md) for what each error means.
