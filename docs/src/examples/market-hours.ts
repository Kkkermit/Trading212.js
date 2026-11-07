import { Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

const status = await t212.exchanges.status("AAPL_US_EQ");

if (status.open) {
	console.log(`${status.exchange} is open; next change: ${status.next?.event} at ${status.next?.at.toISOString()}`);
} else {
	console.log(`Market is ${status.session}; it next opens ${status.nextOpen?.toISOString() ?? "later"}`);
}
