import { OrderOutcomeUnknownError, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();
const request = { ticker: "AAPL_US_EQ", quantity: 1 };

try {
	await t212.orders.buy(request);
} catch (error) {
	if (!(error instanceof OrderOutcomeUnknownError)) throw error;

	// The order may have gone through. Look for it before sending it again.
	const pending = await t212.orders.list();
	const page = await t212.history.orders.list({ ticker: request.ticker, limit: 10 });
	const recentlyFilled = page.items.some(({ order }) => order?.ticker === request.ticker);
	const stillWorking = pending.some((order) => order.ticker === request.ticker);

	if (stillWorking || recentlyFilled) {
		console.log("The first attempt reached Trading 212. Not sending it again.");
	} else {
		console.log("No sign of it, so sending it once more.");
		await t212.orders.buy(request);
	}
}
