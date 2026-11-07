import { Trading212 } from "@kkkermit/trading212.js";

// A live client with trading off: it can preview orders but never send them.
const t212 = Trading212.fromEnv();

const preview = await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 }, { dryRun: true });

console.log(preview.method, preview.url); // POST https://…/api/v0/equity/orders/market
console.log(preview.body); // { ticker: "AAPL_US_EQ", quantity: 1 }
console.log(preview.wouldSend ? "This client would send it" : "Trading is off for this client");
