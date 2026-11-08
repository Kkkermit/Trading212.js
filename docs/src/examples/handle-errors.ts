import { isTrading212Error, Trading212 } from "@kkkermit/trading212.js";

const t212 = Trading212.fromEnv();

try {
	await t212.history.dividends.list();
} catch (error) {
	if (!isTrading212Error(error)) throw error;

	// Every error has a stable code and a hint in plain English.
	switch (error.code) {
		case "authentication":
			console.error("The key or secret is wrong, or it belongs to the other environment.");
			break;
		case "missing_scope":
			console.error("The key lacks a permission.", error.hint);
			break;
		case "rate_limited":
			console.error("Slow down.", error.hint);
			break;
		default:
			console.error(error.message, error.hint);
	}

	// Everything worth recording, with credentials removed.
	console.error(error.toLog());
}
