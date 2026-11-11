import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

for (const result of await t212.orders.cancelAll({ ticker: "AAPL_US_EQ" })) {
	const { id } = result.order;
	if (result.status === "requested") console.log(`Asked Trading 212 to cancel order ${id}`);
	else if (result.status === "gone") console.log(`Order ${id} had already gone`);
	else if (result.status === "unknown") console.log(`Order ${id} may or may not be cancelled: check orders.list()`);
	else console.log(`Order ${id} could not be cancelled: ${result.error.message}`);
}
