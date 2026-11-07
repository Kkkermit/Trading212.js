// Totals every dividend ever paid, by ticker, walking the whole history page by page.
import { Trading212 } from "@kkermit/trading212.js";

const t212 = Trading212.fromEnv();
const totals = new Map<string, number>();

for await (const dividend of t212.history.dividends.all()) {
	const ticker = dividend.ticker ?? "unknown";
	totals.set(ticker, (totals.get(ticker) ?? 0) + (dividend.amount ?? 0));
}

for (const [ticker, total] of [...totals].sort((a, b) => b[1] - a[1]))
	console.log(`${ticker.padEnd(14)} ${total.toFixed(2)}`);
