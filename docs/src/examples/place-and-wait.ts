import {
	OrderOutcomeUnknownError,
	OrderRejectedError,
	Trading212,
	TradingDisabledError,
} from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

try {
	const order = await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 0.5 });
	console.log(`Order ${order.id} sent, status ${order.status}`);

	const settled = await t212.orders.waitFor(order, { timeoutMs: 60_000 });
	console.log(`Order ${settled.id} is ${settled.status}: ${settled.filledQuantity} shares`);
} catch (error) {
	if (error instanceof OrderRejectedError) {
		// Trading 212 said no, and nothing was traded. error.reason is its code.
		console.error(`Refused: ${error.reason}. ${error.hint}`);
	} else if (error instanceof OrderOutcomeUnknownError) {
		// It may have gone through. Look before you send it again.
		console.error(error.message, error.hint);
	} else if (error instanceof TradingDisabledError) {
		console.error('This client only reads. Pass trading: "enabled" to place orders.');
	} else {
		throw error;
	}
}
