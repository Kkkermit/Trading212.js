import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();
const totals = new Map<string, number>();

// Fetches page after page as the loop asks for them, newest first.
for await (const dividend of t212.history.dividends.all()) {
	const ticker = dividend.ticker ?? "unknown";
	totals.set(ticker, (totals.get(ticker) ?? 0) + (dividend.amount ?? 0));
}

const sorted = [...totals].sort(([, a], [, b]) => b - a);
for (const [ticker, total] of sorted) console.log(ticker.padEnd(14), total.toFixed(2));
