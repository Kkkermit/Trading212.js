import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

// The UK tax year that started on 6 April 2026.
const { total, count, currency, byTicker } = await t212.history.dividends.total({
	since: "2026-04-06",
	until: "2027-04-06",
});

console.log(`${count} dividends, ${total.toFixed(2)} ${currency ?? ""}`);
for (const [ticker, amount] of Object.entries(byTicker)) console.log(ticker.padEnd(14), amount.toFixed(2));
