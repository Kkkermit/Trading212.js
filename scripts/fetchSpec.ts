// Downloads Trading 212's published OpenAPI spec into openapi/trading212.json and records where and when.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";

const SOURCE = "https://docs.trading212.com/_bundle/api.yaml";
const ROOT = resolve(import.meta.dirname, "..");
const SPEC = resolve(ROOT, "openapi/trading212.json");

const response = await fetch(SOURCE);
if (!response.ok) {
	console.error(`${SOURCE} answered ${response.status}.`);
	process.exit(1);
}
const spec = parse(await response.text()) as { info?: { version?: string } };
const json = `${JSON.stringify(spec, null, 2)}\n`;
let previous = "";
try {
	previous = readFileSync(SPEC, "utf8");
} catch {
	// First fetch.
}
const unchanged = previous && JSON.stringify(JSON.parse(previous)) === JSON.stringify(spec);
writeFileSync(SPEC, json);
const sha = createHash("sha256").update(json).digest("hex");
const date = new Date().toISOString().slice(0, 10);
writeFileSync(
	resolve(ROOT, "openapi/SOURCE.md"),
	`# Where \`trading212.json\` came from

| | |
| --- | --- |
| API | Trading 212 Public API \`${spec.info?.version ?? "?"}\` (beta) |
| Official source | <${SOURCE}> (YAML, converted to JSON) |
| SHA-256 | \`${sha}\` |
| Fetched | ${date} |

**To refresh:** run \`npm run spec:fetch\`, then \`npm run generate\`, and review the diff. The weekly \`spec-drift\`
workflow does the same and opens a pull request when anything changed. Check \`overrides.json\`: the generator warns about
any entry the spec has caught up with.
`,
);
console.log(
	unchanged ? "The spec has not changed." : `Updated the spec (sha256 ${sha.slice(0, 12)}). Run npm run generate.`,
);
