import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();
const ticker = "AAPL_US_EQ";

if (!(await t212.exchanges.isOpen(ticker))) {
	console.log("Closed. Waiting for the open…");
	// Sleeps until the scheduled opening, up to four days so a weekend fits; extendedHours: true counts pre-market too.
	await t212.exchanges.waitUntilOpen(ticker, { timeoutMs: 4 * 24 * 60 * 60_000 });
}
await t212.orders.buy({ ticker, quantity: 1 });
