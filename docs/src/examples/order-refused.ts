import { OrderRejectedError, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

try {
	await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 0.1 });
} catch (error) {
	if (!(error instanceof OrderRejectedError)) throw error;
	// "POST /api/v0/equity/orders/market was refused: a quantity of 0.1 is below the smallest …"
	console.error(error.message);
	if (error.minQuantity !== undefined) console.error(`Buy at least ${error.minQuantity} shares next time.`);
	if (error.ownedQuantity !== undefined) console.error(`Trading 212 says you own ${error.ownedQuantity}.`);
}
