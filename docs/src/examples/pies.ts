import { Trading212 } from "@kkkermit/trading212.js";

// Changing pies counts as trading, so a live client needs trading: "enabled".
const t212 = Trading212.fromEnv();

const pies = await t212.pies.list();
for (const pie of pies) console.log(pie.id, pie.status, pie.cash);

const [first] = pies;
if (typeof first?.id === "number") {
	const details = await t212.pies.get(first.id);
	console.log(details.settings?.name, details.instruments?.length, "instruments");

	const copy = await t212.pies.duplicate(first.id, { name: `${details.settings?.name} copy` });
	console.log(`Made pie ${copy.settings?.id}`);
}

const created = await t212.pies.create({
	name: "Big tech",
	dividendCashAction: "REINVEST",
	instrumentShares: { AAPL_US_EQ: 0.5, MSFT_US_EQ: 0.5 },
});
console.log(`Created pie ${created.settings?.id}`);
