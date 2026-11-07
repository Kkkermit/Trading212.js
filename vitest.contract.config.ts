import { defineConfig } from "vitest/config";

// Contract tests call the real demo API. They never run in `npm test`, and never against live.
export default defineConfig({
	define: { __VERSION__: JSON.stringify("0.0.0-contract") },
	test: {
		include: ["tests/contract/**/*.test.ts"],
		testTimeout: 120_000,
		fileParallelism: false,
	},
});
