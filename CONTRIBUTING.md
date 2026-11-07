# Contributing

Thanks for helping. Read [AGENTS.md](AGENTS.md) first: it explains the layout and the rules that keep this library
safe around real money. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

1. `npm ci`
2. Make the change, with tests. Use the fake server (`src/testing`) for behaviour and `scriptedFetch` for exact HTTP.
3. `npm run check` must pass.
4. `npm run changeset` if users will notice the change.
5. Commit as `type: Capitalized subject` (for example `fix: Retry a read after a 503`) and open a pull request.

Never use a live API key while developing. Contract tests run against demo only: set `T212_DEMO_API_KEY` and
`T212_DEMO_API_SECRET` and run `npm run test:demo`.
