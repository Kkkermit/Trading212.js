// Tries the library with no key and no network, against the fake Trading 212.
import { OrderRejectedError } from "@kkermit/trading212.js";
import { createFakeTrading212 } from "@kkermit/trading212.js/testing";

const { client, server } = createFakeTrading212({ state: { cash: 1000 } });

const me = await client.verify();
console.log(`Signed in to account ${me.accountId} (${me.currency}) on ${me.environment}.`);

const apple = await client.instruments.resolve("Apple");
console.log(`"Apple" resolves to ${apple.ticker}.`);

const preview = await client.orders.buy({ ticker: apple.ticker, quantity: 2 }, { dryRun: true });
console.log("A dry run sends nothing:", preview.method, preview.url, preview.body);

const order = await client.orders.buy({ ticker: apple.ticker, quantity: 2 });
const filled = await client.orders.waitFor(order);
console.log(`Bought ${filled.filledQuantity} ${apple.ticker}: ${filled.status}.`);

const { cash, holdings } = await client.portfolio.snapshot();
console.log(
	`Cash left ${cash}; holdings: ${holdings.map((holding) => `${holding.ticker} × ${holding.quantity}`).join(", ")}.`,
);

try {
	await client.orders.buy({ ticker: apple.ticker, quantity: 1000 });
} catch (error) {
	if (!(error instanceof OrderRejectedError)) throw error;
	console.log(`Refused as ${error.reason}. Hint: ${error.hint}`);
}

console.log(`The fake recorded ${server.requests.length} requests, keeping no credentials.`);
