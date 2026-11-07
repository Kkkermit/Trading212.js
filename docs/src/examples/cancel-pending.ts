import { NotFoundError, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

const pending = await t212.orders.list();
console.log(`${pending.length} orders are still working`);

for (const order of pending) {
	if (order.ticker !== "AAPL_US_EQ" || typeof order.id !== "number") continue;
	try {
		await t212.orders.cancel(order.id);
		console.log(`Asked Trading 212 to cancel order ${order.id}`);
	} catch (error) {
		// It filled or was cancelled in the meantime.
		if (error instanceof NotFoundError) console.log(`Order ${order.id} has already gone`);
		else throw error;
	}
}
