import { OrderOutcomeUnknownError, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();
const request = { ticker: "AAPL_US_EQ", quantity: 1 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
	await t212.orders.buy(request);
} catch (error) {
	if (!(error instanceof OrderOutcomeUnknownError)) throw error;

	// Trading 212 does not say how long a new order takes to appear in its lists, so look twice before resending.
	await pause(5000);
	let result = await t212.orders.findAfterUnknown(error);
	if (result.status === "not-found") {
		await pause(15_000);
		result = await t212.orders.findAfterUnknown(error);
	}

	if (result.status === "found") {
		console.log(`It reached Trading 212 (${result.order.status}). Not sending it again.`);
	} else if (result.status === "not-found") {
		console.log("No sign of it after 20 seconds, so sending it once more.");
		await t212.orders.buy(request);
	} else {
		console.log(`Cannot tell (${result.reason}). Check the app before trying again.`);
	}
}
