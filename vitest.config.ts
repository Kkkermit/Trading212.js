import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	define: { __VERSION__: JSON.stringify("0.0.0-test") },
	resolve: {
		// The examples import the package by name, as a user would.
		alias: [
			{ find: "@kkermit/trading212.js/testing", replacement: source("./src/testing/index.ts") },
			{ find: "@kkermit/trading212.js/csv", replacement: source("./src/csv/index.ts") },
			{ find: "@kkermit/trading212.js", replacement: source("./src/index.ts") },
		],
	},
	test: {
		include: ["tests/**/*.test.ts", "examples/**/*.test.ts"],
		exclude: ["tests/contract/**"],
		restoreMocks: true,
		setupFiles: ["tests/setup.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			// Re-exports and type-only files have no code to run, so they would only show as 0%.
			exclude: ["src/**/*.generated.ts", "src/types/**", "src/cli/bin.ts", "src/index.ts", "src/resources/context.ts"],
			thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
		},
	},
});
