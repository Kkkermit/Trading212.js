import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv({
	hooks: {
		// Called once for every request that fails, after any retries, wherever it was made.
		onError: ({ endpoint, attempt, error }) => {
			console.error(`${endpoint} failed after ${attempt} attempts: ${error.code}`, error.traceId ?? "");
			// For example: Sentry.captureException(error, { extra: error.toLog() });
		},
	},
});

await t212.account.summary();
