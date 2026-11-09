# Where `trading212.json` came from

| | |
| --- | --- |
| API | Trading 212 Public API `v0` (beta) |
| Official source | <https://docs.trading212.com/_bundle/api.yaml> (YAML, converted to JSON) |
| SHA-256 | `849565371e3037d3e759ab435b3f956333b2953222c5ea6463d221588676908d` |
| Fetched | 2026-11-09 |

**To refresh:** run `npm run spec:fetch`, then `npm run generate`, and review the diff. The weekly `spec-drift`
workflow does the same and opens a pull request when anything changed. Check `overrides.json`: the generator warns about
any entry the spec has caught up with.
