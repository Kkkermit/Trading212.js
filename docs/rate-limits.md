# Rate limits

Trading 212 limits every endpoint separately, **per account**: every key and every IP address on the account shares
one budget.

| Endpoint                                      | Limit                  |
| --------------------------------------------- | ---------------------- |
| `account.summary`                             | 1 / 5 s                |
| `positions.list`, `orders.get`                | 1 / 1 s                |
| `orders.list`                                 | 1 / 5 s                |
| `orders.market`, `orders.cancel`              | 50 / minute            |
| `orders.limit`, `stop`, `stopLimit`           | 1 / 2 s                |
| `history.orders`, `dividends`, `transactions` | 20 / minute            |
| `instruments.list`                            | 1 / 50 s (cached)      |
| `exchanges.list`                              | 1 / 30 s (cached)      |
| `reports.list`                                | 1 / minute             |
| `reports.request`                             | 1 / 30 s               |
| pies                                          | 1 / 5 s, list 1 / 30 s |

`ENDPOINTS` exports the full table, generated from the spec; `client.rateLimits()` shows what the last response
headers said.

## Modes

- **`pace`** (default) spreads calls evenly, so a second `positions.list()` within the same second waits rather than failing.
  Trading 212 recommends this.
- **`burst`** spends a period's whole allowance at once, then waits for the reset. Faster for short bursts.
- **`off`** sends immediately. A 429 still retries reads after the reset.

Either way, the client corrects its budget from every response's `x-ratelimit-*` headers, so spend by another
program on the same account is taken into account as soon as it shows.

If a call would have to wait longer than `maxRateLimitWaitMs` (default 60 s), it throws `RateLimitError` with
`retryAfterMs` instead of hanging.

## Several clients, several processes

Clients created from the same key in the same process share one budget automatically, even across ESM and CommonJS
copies of the package. Two different keys for the same account cannot be told apart until Trading 212 answers, so
they keep separate budgets and the response headers correct them. Separate processes cannot see each other's
spending: run one process per account where you can, and let the headers and retries absorb the rest.

If a 429 arrives while other calls are already waiting for a slot, they wait for the reset too rather than going out
into a closed budget.
