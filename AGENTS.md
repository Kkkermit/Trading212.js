# Working on trading212.js

How this library is built, how to change it safely, and the rules that hold whatever the task. Written for anyone,
person or coding agent, arriving with no memory of earlier sessions. `CLAUDE.md` only points here.

## What it is

An unofficial TypeScript client for the Trading 212 Public API (`v0`, beta). Zero runtime dependencies. It moves
real money, so **safety beats convenience in every trade-off**.

## Commands

| Command                    | Does                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm ci`                   | Install. Always `ci`, unless you are changing dependencies                                            |
| **`npm run check`**        | Typecheck, lint, format, tests with coverage, build, package checks and size. Run before every commit |
| `npm test`                 | Vitest with coverage (90% on every measure)                                                           |
| `npm run generate`         | Regenerate `src/types/api.generated.ts` and `src/http/endpoints.generated.ts`                         |
| `npm run generate:check`   | Fail if the generated files are stale                                                                 |
| `npm run spec:fetch`       | Download the official spec into `openapi/`                                                            |
| `npm run test:demo`        | Contract tests against the **demo** API; needs `T212_DEMO_API_KEY` / `_SECRET`                        |
| `npm run fixtures:capture` | Record real demo error bodies into `fixtures/errors.json`                                             |
| `npm run smoke`            | Run the built package in Node, as ESM and CommonJS; CI also runs it in Bun and Deno                   |
| `npm run secrets`          | Scan the repository for committed secrets                                                             |
| `npm run changeset`        | Describe a user-facing change for the changelog                                                       |

## Layout

```
src/
├── index.ts              public exports only; tests/exports.test.ts pins the list
├── client.ts             Trading212: builds one Transport and the resources around it
├── config.ts             options, validation, fromEnv, the Basic header
├── http/
│   ├── transport.ts      the only place a request is sent: auth, budget, timeout, retries, errors, logs, hooks
│   ├── rateLimiter.ts    per-endpoint budgets, shared per account through globalThis
│   ├── retry.ts          reads only
│   ├── endpoint.ts       the EndpointDefinition type
│   └── endpoints.generated.ts
├── errors/               classes, the response-to-error mapping, and every hint
├── logging/              logger adapters and the one redact()
├── resources/            account, positions, instruments, exchanges, orders, history, reports, pies, portfolio
├── orders/               quantity maths and pre-send validation
├── pagination.ts         Page, PagedList, nextPagePath hardening
├── cache.ts              CacheStore, MemoryCache, single-flight loading
├── testing/              ./testing entry: the fake server and scriptedFetch
├── csv/                  ./csv entry
├── cli/                  the `trading212 doctor` command
└── types/                generated API models and friendly aliases
openapi/                  the vendored spec, SOURCE.md and overrides.json
scripts/                  generateApi, fetchSpec, captureErrors, and the smoke tests
tests/                    one file per source module at the same path; a folder's index.ts is tested in <folder>.test.ts
                          security.test.ts and exports.test.ts cover the whole package; tests/contract runs against demo only
examples/                 type-checked; *.test.ts files run with the suite
docs/                     the guides
.github/                  CI, nightly, CodeQL, release and spec-drift workflows; Dependabot; issue and PR templates
```

## Rules that hold whatever the task

1. **Never use live.** No live credentials, no request to `live.trading212.com`, ever. Unit tests never touch the
   network; contract tests use demo only and only when run on purpose.
2. **Never retry a trade.** `kind: "trade"` endpoints get one attempt. Do not add an option that changes this.
   `ENDPOINTS` is frozen so nothing at run time can change an endpoint's kind.
3. **A trade that may have run is `OrderOutcomeUnknownError`**, never a plain failure. Only a failure that certainly
   happened before sending (`NOT_SENT` codes, an abort before the request) may say otherwise.
4. **Nothing secret is printed.** Every new log field, error property, hook event or recorded value goes through
   `redact()`, and gets a case in `tests/security.test.ts`.
5. **Credentials only go to the configured origin.** No redirects, `nextPagePath` pinned, downloads without auth.
6. **Zero runtime dependencies.** Adding one needs the maintainer's approval first.
7. **The spec is the source of truth.** Endpoint facts come from `openapi/` through the generator. A behaviour the
   spec does not state is either confirmed against demo (contract test or `fixtures/errors.json`) or marked as
   unconfirmed where it is used. Never state API behaviour from memory.
8. **Generated files are regenerated, never edited.** Corrections the live docs make go in `openapi/overrides.json`.
9. **No publishing, tagging, releasing or repository settings changes.** Prepare them and say what to run.
10. **A method that returns a promise never throws synchronously.** Make it `async`.

## Adding or changing an endpoint

1. `npm run spec:fetch`, then `npm run generate`. A new path fails generation until it has a name in `NAMES` in
   `scripts/generateApi.ts`; a harmless write goes in `HARMLESS_WRITES`.
2. Add the method to the right resource: a few lines that call `transport.request(ENDPOINTS.x, …)`. TSDoc it with
   the scope and rate limit, and an `@example` when it is not obvious.
3. Teach `src/testing/fakeServer.ts` the route, so users' tests can use it.
4. Test the method against the fake, and its failure modes with `scriptedFetch`.
5. Document it in the right guide and add a changeset.

## Tests

- **A test must be able to fail.** For every guard, put the bug back, watch the test go red, then revert. Every
  safety guard has been checked this way: redaction (including log messages and `__proto__` keys), the live switch,
  no trade retries, unknown outcomes after a 5xx or an interrupted body, pinned pagination, manual redirects,
  truncation, the position match, credential-free downloads, refused rate-limit reservations booking nothing, cache
  failures being bypassed, the live switch behind a custom `baseUrl`, unknown outcomes for unreadable successes and
  redirects, waiting calls rechecking a 429, aborts not crossing between callers of a shared download, and the
  frozen endpoint table. Keep it true.
- Name the behaviour, not the implementation. A one-line `/** */` above a test says which bug it pins.
- Prefer the fake server for behaviour and `scriptedFetch` for exact HTTP.
- Each test starts with empty rate-limit budgets (`tests/setup.ts`).

## Dependencies and CI

- `npm audit` must report nothing, at any severity, including development dependencies. CI fails otherwise.
- `overrides.minimatch` in `package.json` forces the patched release (GHSA-g3hv-75wg-m249) under ESLint and
  typescript-eslint. Remove it once they depend on `minimatch@11.0.1` or later. TypeDoc was dropped because no
  release works with the patched version.
- Every GitHub Action is pinned to a full commit with its version in a comment. Dependabot keeps both current.
- Workflows get `contents: read` unless a job needs more, and only that job is granted it.
- CI runs on every push and pull request; the nightly run repeats the test matrix on the newest Node, re-audits,
  runs the demo contract tests when their secrets are set, and opens an issue when it fails.

## Style

- TypeScript strict, with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Prettier: tabs, width 120.
- Comments are rare and one sentence: a constraint or a quirk the code cannot say itself. Never narrate a change.
- User-facing text (errors, hints, docs) is plain British English, says what to do, and never blames.
- Commits: `type: Capitalized subject`, with types `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`,
  `add`, `update` and `remove`. commitlint enforces it.

## Working style

- Verify, do not assume. Read the spec, the fixture or the dependency's source before theorising.
- Say what you could not verify, and which parts are proven.
- Do the whole task. If part is blocked, finish the rest and say what was left and why.
