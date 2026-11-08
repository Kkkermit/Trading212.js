import { Trading212 } from "@kkkermit/trading212.js";

const counts = new Map<string, number>();

const t212 = Trading212.fromEnv({
	hooks: {
		onRequest: ({ endpoint, attempt }) => {
			counts.set(endpoint, (counts.get(endpoint) ?? 0) + 1);
			if (attempt > 1) console.log(`${endpoint}: attempt ${attempt}`);
		},
		onResponse: ({ endpoint, status, durationMs, rateLimit }) => {
			console.log(`${endpoint} ${status} in ${durationMs} ms, ${rateLimit?.remaining ?? "?"} left`);
		},
		onRetry: ({ endpoint, delayMs, error }) => console.log(`${endpoint} retries in ${delayMs} ms: ${error.code}`),
		onRateLimitWait: ({ endpoint, waitMs }) => console.log(`${endpoint} waits ${waitMs} ms for budget`),
	},
});

await t212.portfolio.snapshot();
console.log(Object.fromEntries(counts));
