---
title: Getting started
---

# Getting started

## 1. Make a key

In the Trading 212 app: **Settings → API (Beta) → Generate key**.

- Choose the environment first. A key made in practice mode works on **demo** only; one made with real money works on
  **live** only. Using the wrong one gives `AuthenticationError`, whose hint says exactly this.
- Tick only the permissions the program needs:

  | Permission             | Lets the key                                  |
  | ---------------------- | --------------------------------------------- |
  | `account`              | read the account summary (needed by `verify`) |
  | `portfolio`            | read positions                                |
  | `metadata`             | read instruments and exchanges                |
  | `orders:read`          | read pending orders                           |
  | `orders:execute`       | place and cancel orders                       |
  | `history:orders`       | read order history                            |
  | `history:dividends`    | read dividends                                |
  | `history:transactions` | read deposits, withdrawals, fees and interest |
  | `pies:read`            | read pies (deprecated)                        |
  | `pies:write`           | change pies (deprecated)                      |

- The secret is shown once. Put it in your secret manager or a `.env` file that git ignores.
- Optionally restrict the key to fixed IP addresses.

## 2. Check it

```sh
T212_ENV=demo T212_API_KEY=... T212_API_SECRET=... npx @kkermit/trading212.js doctor
# or keep them in a file:
npx @kkermit/trading212.js doctor --env-file .env
```

The doctor signs in, then tries one read for each permission and reports which are missing. It never prints your
key or secret, and never places an order. `--json` prints the result for scripts.

## 3. Make a client

```ts
import { Trading212 } from "@kkermit/trading212.js";

const t212 = new Trading212({
	environment: "demo",
	apiKey: process.env.T212_API_KEY!,
	apiSecret: process.env.T212_API_SECRET!,
});
// or
const fromEnv = Trading212.fromEnv();
```

`fromEnv()` reads `T212_ENV`, `T212_API_KEY` and `T212_API_SECRET`, the same names Trading 212's own tools use. If
you keep a key per environment, set `T212_DEMO_API_KEY` / `T212_DEMO_API_SECRET` and `T212_LIVE_API_KEY` /
`T212_LIVE_API_SECRET`, and switch with `T212_ENV`. It does not read `.env` files; use `node --env-file=.env` or
your framework for that.

**There is no default environment.** Trading 212's own guide defaults to live and other libraries default to demo.
When guesses disagree, guessing is the bug.

## Options

| Option                   | Default                                                   | What it does                                                      |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `environment`            | required                                                  | `"demo"` or `"live"`                                              |
| `apiKey`, `apiSecret`    | required                                                  | Checked for whitespace, swaps and other copy-paste slips          |
| `trading`                | enabled on demo, disabled on live                         | Whether orders, cancellations and pie changes may be sent         |
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

Every method also takes `{ signal }` to cancel it, and `{ timeoutMs }`.

## Where next

- [Orders](orders.md) to place your first demo trade.
- [Data](data.md) for instruments, history, reports and the portfolio snapshot.
- [Errors](errors.md) for what each error means.
