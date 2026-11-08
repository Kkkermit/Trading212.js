import { Trading212, ValidationError } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

try {
	// Sells quantityAvailableForTrading, cut to 4 decimal places, at market.
	const order = await t212.orders.sellAll("AAPL_US_EQ");
	console.log(`Selling ${Math.abs(order.quantity ?? 0)} shares in order ${order.id}`);
} catch (error) {
	// Nothing held, or everything is in pies or reserved by pending orders.
	if (error instanceof ValidationError) console.error(error.message, error.hint);
	else throw error;
}
