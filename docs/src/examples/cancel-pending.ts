import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

for (const result of await t212.orders.cancelAll({ ticker: "AAPL_US_EQ" })) {
	if (result.status === "requested") console.log(`Asked Trading 212 to cancel order ${result.order.id}`);
	else if (result.status === "gone") console.log(`Order ${result.order.id} had already gone`);
	else console.log(`Order ${result.order.id} could not be cancelled: ${result.error.message}`);
}
