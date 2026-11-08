// The CommonJS build, loaded with require().
const assert = require("node:assert/strict");
const { Trading212, MissingScopeError } = require("../dist/index.cjs");
const { createFakeTrading212 } = require("../dist/testing.cjs");

(async () => {
	const { client, server } = createFakeTrading212();
	server.failNext("listPositions", { status: 403, body: { message: "Scope( portfolio ) missing for API key" } });
	await assert.rejects(
		client.positions.list(),
		(error) => error instanceof MissingScopeError && error.scope === "portfolio",
	);
	assert.ok(new Trading212({ environment: "demo", apiKey: "smoke-key", apiSecret: "smoke-secret" }));
	console.log("smoke ok: CommonJS");
})();
