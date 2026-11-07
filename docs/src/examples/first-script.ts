import { Trading212 } from "@kkkermit/trading212.js";

// Reads T212_ENV, T212_API_KEY and T212_API_SECRET.
const t212 = Trading212.fromEnv();

const me = await t212.verify();
console.log(`Signed in to account ${me.accountId} on ${me.environment}.`);

const { totalValue, cash, holdings } = await t212.portfolio.snapshot();
console.log(`Total ${totalValue}, of which cash ${cash}.`);

for (const holding of holdings) {
	const percent = (holding.weight * 100).toFixed(1);
	console.log(`${holding.ticker}: ${holding.quantity} shares, ${percent}% of the portfolio`);
}
