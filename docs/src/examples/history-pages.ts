import { isTrading212Error, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

// One page at a time: up to 50 items, newest first.
const first = await t212.history.orders.list({ ticker: "AAPL_US_EQ", limit: 50 });
for (const { order, fill } of first.items) console.log(order?.id, order?.status, fill?.price);

// The cursor is a plain string, so it can be saved and used later.
if (first.nextCursor) {
	const second = await t212.history.orders.list({ cursor: first.nextCursor });
	console.log(`The second page has ${second.items.length} orders`);
}

// When a long walk fails part-way, resumeCursor says where to carry on.
try {
	for await (const transaction of t212.history.transactions.all({ maxItems: 1000 })) {
		console.log(transaction.dateTime, transaction.type, transaction.amount);
	}
} catch (error) {
	if (isTrading212Error(error) && error.resumeCursor) {
		console.log(`Stopped early. Carry on with { cursor: "${error.resumeCursor}" }`);
	} else {
		throw error;
	}
}
