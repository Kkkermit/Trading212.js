import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();
const snapshot = await t212.portfolio.snapshot();

const money = new Intl.NumberFormat("en-GB", {
	style: "currency",
	currency: snapshot.currency ?? "GBP",
});

console.log(`Total ${money.format(snapshot.totalValue)}, cash ${money.format(snapshot.cash)}`);
console.log(`Unrealised profit ${money.format(snapshot.unrealisedProfitLoss)}`);

for (const holding of snapshot.holdings) {
	const weight = `${(holding.weight * 100).toFixed(1)}%`;
	const change = holding.profitLossRatio === undefined ? "" : ` (${(holding.profitLossRatio * 100).toFixed(1)}%)`;
	console.log(`${holding.ticker.padEnd(14)} ${money.format(holding.value).padStart(12)} ${weight}${change}`);
}
