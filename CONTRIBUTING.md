# Contributing

Thanks for helping. Read [AGENTS.md](AGENTS.md) first: it explains the layout and the rules that keep this library
safe around real money. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

1. `npm ci`
2. Make the change, with tests. Use the fake server (`src/testing`) for behaviour and `scriptedFetch` for exact HTTP.
3. `npm run check` must pass.
4. If the change is one users will notice, update its page in `docs/src/content/docs` (preview with
   `npm run docs:dev`) and run `npm run changeset`.
5. Commit as `type: Capitalized subject` (for example `fix: Retry a read after a 503`) and open a pull request.

To try a change the way a user would, run an example against the source with
`npm run example examples/try-it-offline.ts`, or build and install the package into another project:

```sh
npm run build && npm pack
cd ../your-project && npm install ../trading212.js/kkermit-trading212.js-0.0.0.tgz
```

Maintainers: [RELEASING.md](RELEASING.md) covers publishing to npm and deploying the docs.

Never use a live API key while developing. Contract tests run against demo only: set `T212_DEMO_API_KEY` and
`T212_DEMO_API_SECRET` and run `npm run test:demo`.
