import {
	consoleLogger,
	InstrumentNotFoundError,
	OrderOutcomeUnknownError,
	OrderRejectedError,
	Trading212,
} from "@kkkermit/trading212.js";

// 1. Connect, with info logging so every order is recorded.
const t212 = Trading212.fromEnv({ logger: consoleLogger({ level: "info" }) });
const me = await t212.verify();
console.log(`Account ${me.accountId} on ${me.environment}, trading ${me.trading}`);

// 2. Look at what you have.
const { totalValue, cash } = await t212.portfolio.snapshot();
console.log(`Total ${totalValue}, cash ${cash}`);

// 3. Turn a name into a Trading 212 ticker.
let ticker: string;
try {
	ticker = (await t212.instruments.resolve("Apple", { currency: "USD" })).ticker;
} catch (error) {
	if (error instanceof InstrumentNotFoundError) console.error(error.hint);
	throw error;
}

// 4. Check the market is open.
const market = await t212.exchanges.status(ticker);
if (!market.open) {
	console.log(`The market is ${market.session}; it opens ${market.nextOpen?.toISOString()}`);
	process.exit(0);
}

// 5. Preview the order, then place it and wait for the fill.
const preview = await t212.orders.buy({ ticker, quantity: 1 }, { dryRun: true });
console.log("Would send", preview.body);

try {
	const order = await t212.orders.buy({ ticker, quantity: 1 });
	const settled = await t212.orders.waitFor(order);
	console.log(`Order ${settled.id}: ${settled.status}`);
} catch (error) {
	if (error instanceof OrderRejectedError) console.error(`Refused: ${error.hint}`);
	else if (error instanceof OrderOutcomeUnknownError) console.error(error.hint);
	else throw error;
}
