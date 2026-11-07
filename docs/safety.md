---
title: Safety and security
---

# Safety and security

## Around real money

| Guard                                      | What it prevents                                        |
| ------------------------------------------ | ------------------------------------------------------- |
| No default environment                     | Running against live because nobody said otherwise      |
| Live reads only until `trading: "enabled"` | A script written for demo placing real orders           |
| Orders are never retried                   | Buying twice because the first answer was slow          |
| `OrderOutcomeUnknownError`                 | Treating "maybe executed" as "failed" and resending     |
| `NetworkError` with `sent: false`          | Being unsure when a request certainly never left        |
| `buy()`/`sell()` set the sign              | A stray minus sign turning a sale into a purchase       |
| Validation before sending                  | Wasting rate limit on requests Trading 212 would refuse |
| `truncateQuantity()` and `sellAll()`       | Rounding up past what you own                           |
| `dryRun`                                   | Not knowing exactly what will be sent                   |

## Your credentials

- The key and secret live in private class fields. They are not on any enumerable property, so `JSON.stringify`,
  `console.log` and `util.inspect` of the client show only the environment.
- Every log line, error, hook event and test recording is redacted (see [Logging](logging.md)).
- Requests go only to `https://demo.trading212.com` or `https://live.trading212.com`, unless you set `baseUrl`,
  which must be `https://` (or `http://localhost` for tests) and logs a warning.
- Redirects are never followed, because following one would send your credentials wherever it pointed.
- `nextPagePath` is followed only to the same endpoint on the same host.
- Report downloads go to a signed link without your credentials.
- The client refuses to run in a browser.
- `doctor` never prints the key or secret, and redacts its own output as well.

## Advice

- Make one key per program, with the fewest permissions it needs. A dashboard needs no `orders:execute`.
- Restrict keys to fixed IP addresses where you can.
- Keep demo and live keys apart; `T212_DEMO_*` and `T212_LIVE_*` help.
- If a key leaks, delete it in the app straight away and make a new one.

## Supply chain

Zero runtime dependencies. Published from GitHub Actions with npm provenance, so you can check a release was built
from this repository. Development dependencies are pinned by the lockfile and audited in CI.
