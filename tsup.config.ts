import { readFileSync } from "node:fs";

import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const define = { __VERSION__: JSON.stringify(version) };

export default defineConfig([
	{
		entry: { index: "src/index.ts", testing: "src/testing/index.ts", csv: "src/csv/index.ts" },
		format: ["esm", "cjs"],
		dts: true,
		clean: true,
		// One shared chunk, so the testing kit and the client share the same classes.
		splitting: true,
		treeshake: true,
		target: "es2023",
		platform: "neutral",
		define,
	},
	{
		entry: { cli: "src/cli/bin.ts" },
		format: ["esm"],
		target: "node22",
		platform: "node",
		banner: { js: "#!/usr/bin/env node" },
		define,
	},
]);
