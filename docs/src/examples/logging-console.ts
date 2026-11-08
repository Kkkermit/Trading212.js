import { consoleLogger, Trading212 } from "@kkkermit/trading212.js";

// info shows every order and every warning; debug adds every read.
const t212 = Trading212.fromEnv({ logger: consoleLogger({ level: "info" }) });

await t212.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 });
// [trading212] INFO  Sending POST /api/v0/equity/orders/market endpoint=placeMarketOrder attempt=1
// [trading212] INFO  POST /api/v0/equity/orders/market returned 200 in 212 ms endpoint=placeMarketOrder …
