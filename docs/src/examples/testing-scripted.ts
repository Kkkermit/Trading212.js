import { Trading212 } from "@kkkermit/trading212.js";
import { networkError, scriptedFetch } from "@kkkermit/trading212.js/testing";

// Each request takes the next step: a response, a function of the request, or a network failure.
const { fetch, requests, pending } = scriptedFetch([
	{ status: 503 },
	{ body: { id: 1, currency: "GBP", totalValue: 100 }, headers: { "x-ratelimit-remaining": "0" } },
	(request) => ({ body: { echoed: request.query } }),
	networkError("ECONNREFUSED"),
]);

const t212 = new Trading212({
	environment: "demo",
	apiKey: "test-key",
	apiSecret: "test-secret",
	fetch,
	rateLimit: "off",
	retry: { baseDelayMs: 1 },
});

const summary = await t212.account.summary(); // retried after the 503
console.log(summary.totalValue); // 100
console.log(requests.length, pending()); // 2 requests made, 2 steps left
console.log(requests[0]?.authorized); // true, and the credentials themselves are never recorded
