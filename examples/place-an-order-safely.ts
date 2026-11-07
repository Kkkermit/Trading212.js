// Finds an instrument by name, checks its market is open, previews the order, then places it and waits for the fill.
import { OrderOutcomeUnknownError, OrderRejectedError, Trading212 } from "@kkermit/trading212.js";

const t212 = Trading212.fromEnv();

const apple = await t212.instruments.resolve("AAPL", { currency: "USD" });
const market = await t212.exchanges.status(apple);
if (!market.open) {
	console.log(
		`${apple.ticker}'s market is ${market.session}; it next opens ${market.nextOpen?.toISOString() ?? "later"}.`,
	);
	process.exit(0);
}

const preview = await t212.orders.buy({ ticker: apple.ticker, quantity: 0.1 }, { dryRun: true });
console.log("Would send:", preview.body, preview.wouldSend ? "" : "(this client has trading off)");

try {
	const order = await t212.orders.buy({ ticker: apple.ticker, quantity: 0.1 });
	const settled = await t212.orders.waitFor(order);
	console.log(`Order ${settled.id ?? "?"} is ${settled.status ?? "?"}.`);
} catch (error) {
	if (error instanceof OrderRejectedError) console.error(`Refused (${error.reason}): ${error.hint ?? ""}`);
	else if (error instanceof OrderOutcomeUnknownError) console.error(`Check before retrying: ${error.hint ?? ""}`);
	else throw error;
}
