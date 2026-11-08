import { consoleLogger, MemoryCache, Trading212 } from "@kkkermit/trading212.js";

const t212 = new Trading212({
	environment: "demo",
	apiKey: process.env.T212_API_KEY ?? "",
	apiSecret: process.env.T212_API_SECRET ?? "",

	trading: "enabled",
	timeoutMs: 15_000,
	retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10_000 },
	rateLimit: "pace",
	maxRateLimitWaitMs: 60_000,
	logger: consoleLogger({ level: "info" }),
	hooks: { onResponse: ({ endpoint, status }) => console.log(endpoint, status) },
	cache: new MemoryCache(),
	metadataTtlMs: 60 * 60 * 1000,
	userAgent: "my-portfolio-bot/1.0",
});

console.log(t212.environment, t212.trading); // demo enabled
