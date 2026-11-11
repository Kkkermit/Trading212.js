import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();
const orders = t212.watch.orders();

orders.on("filled", ({ order, fill }) => {
	console.log(`${order.side} ${order.quantity} ${order.ticker} filled at ${fill?.price ?? "?"}`);
});
orders.on("cancelled", ({ order }) => console.log(`Order ${order.id} was cancelled`));
orders.on("error", ({ error, willRetry }) => console.error(error.message, willRetry ? "(retrying)" : "(stopped)"));

// Stop watching after an hour.
setTimeout(() => orders.stop(), 60 * 60_000);
