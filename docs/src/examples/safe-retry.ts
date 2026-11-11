import { OrderOutcomeUnknownError, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();
const request = { ticker: "AAPL_US_EQ", quantity: 1 };

try {
	await t212.orders.buy(request);
} catch (error) {
	if (!(error instanceof OrderOutcomeUnknownError)) throw error;

	// The order may have gone through. Give Trading 212 a moment to list it, then look.
	await new Promise((resolve) => setTimeout(resolve, 5000));
	const result = await t212.orders.findAfterUnknown(error);

	if (result.status === "found") {
		console.log(`It reached Trading 212 (${result.order.status}). Not sending it again.`);
	} else if (result.status === "not-found") {
		console.log("No sign of it, so sending it once more.");
		await t212.orders.buy(request);
	} else {
		console.log(`Cannot tell (${result.reason}). Check the app before trying again.`);
	}
}
