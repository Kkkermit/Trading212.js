import { Trading212 } from "@kkkermit/trading212.js";

// The same as passing logger: consoleLogger({ level: "debug" }).
const t212 = new Trading212({
	environment: "demo",
	apiKey: process.env.T212_DEMO_API_KEY ?? "",
	apiSecret: process.env.T212_DEMO_API_SECRET ?? "",
	logger: "debug",
});

await t212.account.summary();
// [trading212] DEBUG Sending GET /api/v0/equity/account/summary endpoint=getAccountSummary attempt=1
