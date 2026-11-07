// Prints a summary of the account. Run with: T212_ENV=demo T212_API_KEY=... T212_API_SECRET=... npx tsx examples/portfolio-snapshot.ts
import { Trading212 } from "@kkermit/trading212.js";

const t212 = Trading212.fromEnv();
const snapshot = await t212.portfolio.snapshot();
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: snapshot.currency ?? "GBP" });

console.log(`Total ${money.format(snapshot.totalValue)} · cash ${money.format(snapshot.cash)}`);
for (const holding of snapshot.holdings) {
	const change = holding.profitLossRatio === undefined ? "" : ` (${(holding.profitLossRatio * 100).toFixed(1)}%)`;
	console.log(
		`${holding.ticker.padEnd(14)} ${money.format(holding.value).padStart(12)} ${(holding.weight * 100).toFixed(1).padStart(5)}%${change}`,
	);
}
