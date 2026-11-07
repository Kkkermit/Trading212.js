import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

const positions = await t212.positions.list();
for (const position of positions) {
	console.log(position.instrument?.ticker, position.quantity, position.currentPrice);
}

const apple = await t212.positions.get("AAPL_US_EQ");
if (apple) {
	// Shares in pies, or reserved by pending orders, cannot be sold directly.
	console.log(`You hold ${apple.quantity}, of which ${apple.quantityAvailableForTrading} can be sold`);
} else {
	console.log("You hold no Apple");
}
