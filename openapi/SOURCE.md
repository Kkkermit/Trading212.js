# Where `trading212.json` came from

| | |
| --- | --- |
| API | Trading 212 Public API `v0` (beta), OpenAPI 3.0.1 |
| Official source | <https://docs.trading212.com/_bundle/api.yaml> |
| This copy | Taken from the community repositories `mingchuno/trading212-mcp` and `zaini/trading212-sdk`, which vendor byte-identical copies of the official spec |
| SHA-256 | `51b0da636efff0b0e4c8e47fc3a5ba804f65d35d4d0beb910416322ffb119c13` |
| Vendored | 7 Nov 2026 |

The official host was not reachable from the environment this was first built in, so this copy is second-hand. It
is known to be slightly older than the live docs: the three history endpoints allow 20 requests a minute live, not
6. `overrides.json` corrects that until a fresh copy lands.

**To refresh:** run `npm run spec:fetch`, then `npm run generate`, and review the diff. The weekly `spec-drift`
workflow does the same and opens an issue when anything changed.
