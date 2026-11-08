import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Contract tests call the real demo API. They never run in `npm test`, and never against live.
// T212_DEMO_API_KEY and T212_DEMO_API_SECRET come from the shell or .env; the shell wins.
const envFile = fileURLToPath(new URL(".env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
	define: { __VERSION__: JSON.stringify("0.0.0-contract") },
	test: {
		include: ["tests/contract/**/*.test.ts"],
		testTimeout: 120_000,
		fileParallelism: false,
	},
});
