import { createFakeTrading212 } from "@kkkermit/trading212.js/testing";

// A real client talking to an in-memory Trading 212: no key, no network.
const { client } = createFakeTrading212({ state: { cash: 1000 } });

const apple = await client.instruments.resolve("Apple");
console.log(`"Apple" is ${apple.ticker}`);

const order = await client.orders.buy({ ticker: apple.ticker, quantity: 2 });
const filled = await client.orders.waitFor(order);
console.log(`Order ${filled.id} is ${filled.status}`);

const { cash, holdings } = await client.portfolio.snapshot();
console.log(`Cash left: ${cash}. Holding: ${holdings.map((holding) => holding.ticker).join(", ")}`);
