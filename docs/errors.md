---
title: Errors
---

# Errors

Every error the library throws extends `Trading212Error` and carries:

| Field          | Holds                                                           |
| -------------- | --------------------------------------------------------------- |
| `code`         | A stable name, such as `missing_scope`, for `switch` statements |
| `hint`         | What to do about it, in plain English                           |
| `status`       | The HTTP status, if there was a response                        |
| `request`      | `{ method, path, endpoint }`, never headers or credentials      |
| `rateLimit`    | What the rate-limit headers said                                |
| `body`         | The response body, parsed and redacted                          |
| `apiCode`      | Trading 212's own code, from `code` or a problem-details `type` |
| `resumeCursor` | On a failed history iteration, where to carry on                |
| `toLog()`      | All of the above as a plain object, safe to hand to any logger  |

`instanceof` works on every class, even when ESM and CommonJS copies of the package are both loaded.
`isTrading212Error(value)` checks for any of them.

## Catalogue

### `ConfigurationError` — `configuration`

The options, or the environment variables behind `fromEnv()`, are wrong. `error.field` names the option. Nothing was
sent. Common causes: no `environment`; whitespace around the key; the key pasted into `apiSecret`.

### `AuthenticationError` — `authentication` (401)

Trading 212 refused the key and secret. Check both were copied exactly. **A key works in one environment only**: a
key made in practice mode is refused by live, and the other way round. `error.environment` says which this client
used.

### `MissingScopeError` — `missing_scope` (403)

The key exists but lacks a permission; `error.scope` names it, such as `orders:execute`. Create a key with it ticked.
Run `npx @kkermit/trading212.js doctor` to see every missing permission at once.

### `NotAvailableInDemoError` — `not_available_in_demo` (403)

The feature only exists on live. CSV exports are the known case.

### `PermissionError` — `permission` (403)

Any other refusal. If the key is restricted to IP addresses, check this machine's public address is on its list.

### `ValidationError` — `validation` (400, or before sending)

The request was invalid. When the client caught it before sending, `error.issues` lists every field at fault.

### `OrderRejectedError` — `order_rejected` (400)

Trading 212 refused an order; nothing was traded. `error.reason`:

| Reason                         | Fix                                                                        |
| ------------------------------ | -------------------------------------------------------------------------- |
| `InsufficientFreeForStocksBuy` | Not enough free cash; check `cash.availableToTrade`                        |
| `SellingEquityNotOwned`        | Selling more than available; shares in pies or pending orders do not count |
| `MarketClosed`                 | Check `exchanges.status(ticker)`                                           |
| `QuantityPrecisionMismatch`    | More than 4 decimal places; use `truncateQuantity()`                       |
| anything else                  | Trading 212's own code, passed through                                     |

### `NotFoundError` — `not_found` (404)

For `orders.get()` this usually means the order has filled or been cancelled: look in `history.orders`.

### `InstrumentNotFoundError` — `instrument_not_found`

`instruments.resolve()` found nothing, or several equally good matches. `error.suggestions` lists the closest.

### `RateLimitError` — `rate_limited` (429)

Out of budget; `error.retryAfterMs` and `error.resetAt` say when it resets. Reads retry by themselves when the wait
is short. Also thrown before sending when the client would have to wait longer than `maxRateLimitWaitMs`.

### `TimeoutError` — `timeout` (408, or `timeoutMs`)

No answer in time. Reads are retried; this one ran out of attempts.

### `OrderOutcomeUnknownError` — `outcome_unknown`

**An order, cancellation or pie change may or may not have happened**: it timed out, the connection dropped, the
call was aborted after sending, or Trading 212 answered 5xx. `error.sent` holds what was sent. Check `orders.list()`
and `history.orders.list()` before trying again. Never resend blindly.

### `TradingDisabledError` — `trading_disabled`

A live client was asked to trade without `trading: "enabled"`. Nothing was sent.

### `NetworkError` — `network`

The connection failed. `error.sent` is `false` when it failed before reaching Trading 212 (DNS, refused, TLS), which
makes even an order safe to retry.

### `ServerError` — `server` (5xx), `HttpError` — `http_error`, `UnexpectedResponseError` — `unexpected_response`

Trading 212 had a problem; any other status; or a response the client could not read, including a redirect it
refused to follow with your credentials.

## Error bodies

Trading 212's spec documents no error body. `parseErrorBody()` reads every shape seen in practice: problem details
(`{ type, title, status, detail }`), `{ code, clarification }`, `{ code, message }`, plain text and empty. Bodies are
redacted before they are kept.
