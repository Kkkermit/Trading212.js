import { InstrumentNotFoundError, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

// The best matches first, from the cached instrument list.
const results = await t212.instruments.search("vanguard s&p", { type: "ETF", limit: 5 });
for (const instrument of results) console.log(instrument.ticker, instrument.name);

// Exactly one instrument, or an error listing the closest matches.
try {
	const apple = await t212.instruments.resolve("AAPL", { currency: "USD" });
	console.log(`AAPL is ${apple.ticker}, traded in ${apple.currencyCode}`);
} catch (error) {
	if (!(error instanceof InstrumentNotFoundError)) throw error;
	console.log(
		"Did you mean:",
		error.suggestions.map((suggestion) => suggestion.ticker),
	);
}

// When you already have the Trading 212 ticker.
const exact = await t212.instruments.find("AAPL_US_EQ");
console.log(exact?.name ?? "No such ticker");
