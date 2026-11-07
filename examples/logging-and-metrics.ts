// Sends the client's log lines to the console (or pino), and counts requests with hooks.
import { consoleLogger, fieldsFirst, type Logger, Trading212 } from "@kkkermit/trading212.js";

// With pino: `const logger = fieldsFirst(pino())`. Any logger with debug/info/warn/error works.
declare const pino: (() => Parameters<typeof fieldsFirst>[0]) | undefined;
const logger: Logger = typeof pino === "function" ? fieldsFirst(pino()) : consoleLogger({ level: "debug" });

const counts = new Map<string, number>();
const t212 = Trading212.fromEnv({
	logger,
	hooks: {
		onResponse: ({ endpoint, status, durationMs }) => {
			counts.set(endpoint, (counts.get(endpoint) ?? 0) + 1);
			if (durationMs > 2000) console.warn(`${endpoint} took ${durationMs} ms (${status})`);
		},
	},
});

await t212.verify();
console.log(Object.fromEntries(counts), t212.rateLimits().getAccountSummary);
