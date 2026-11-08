// Runs the built package the way a user would, in whichever runtime starts it: node, bun or deno.
import assert from "node:assert/strict";

const { Trading212, TradingDisabledError, VERSION } = await import("../dist/index.js");
const { createFakeTrading212 } = await import("../dist/testing.js");
const { parseCsv } = await import("../dist/csv.js");

const { client, server } = createFakeTrading212({ state: { cash: 1000 } });
const order = await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 });
assert.equal((await client.orders.waitFor(order)).status, "FILLED");
assert.equal(server.position("AAPL_US_EQ")?.quantity, 1);

const live = createFakeTrading212({ environment: "live", client: { trading: "disabled" } }).client;
await assert.rejects(
	live.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 }),
	(error) => error instanceof TradingDisabledError,
);

assert.deepEqual(parseCsv("a,b\n1,2\n"), [{ a: "1", b: "2" }]);
assert.ok(new Trading212({ environment: "demo", apiKey: "smoke-key", apiSecret: "smoke-secret" }));
console.log(`smoke ok: trading212.js ${VERSION}`);
