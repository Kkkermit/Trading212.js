import { RateLimitError, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv({
	// pace (the default) spreads calls out; burst spends a period's allowance at once; off sends immediately.
	rateLimit: "pace",
	// Throw RateLimitError rather than wait longer than 10 seconds for budget.
	maxRateLimitWaitMs: 10_000,
});

try {
	for (let i = 0; i < 3; i++) await t212.positions.list();
} catch (error) {
	if (!(error instanceof RateLimitError)) throw error;
	console.log(`Try again in ${error.retryAfterMs} ms`);
}

// What the last response headers said about each endpoint's budget.
const budgets = t212.rateLimits();
console.log(budgets.listPositions); // { limit: 1, periodMs: 1000, remaining: 0, resetAt: Date }
