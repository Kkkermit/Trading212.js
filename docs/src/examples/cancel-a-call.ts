import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

// Give up on one call after 5 seconds, whatever the client's own timeout.
const summary = await t212.account.summary({ timeoutMs: 5_000 });
console.log(summary.totalValue);

// Or cancel calls yourself, such as when your program shuts down.
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());

for await (const order of t212.history.orders.all({ signal: controller.signal })) {
	console.log(order.order?.id);
}
