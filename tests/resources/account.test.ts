import { describe, expect, it } from "vitest";

import { createFakeTrading212 } from "../../src/testing";

import { scripted } from "../helpers";

describe("account and verify", () => {
	it("verifies the key and names the account", async () => {
		const { client } = createFakeTrading212({ state: { accountId: 42, currency: "EUR" } });
		await expect(client.verify()).resolves.toEqual({
			environment: "demo",
			accountId: 42,
			currency: "EUR",
			trading: "enabled",
		});
	});

	it("copes with a summary that leaves fields out", async () => {
		const { client } = scripted([{ body: {} }]);
		await expect(client.verify()).resolves.toEqual({
			environment: "demo",
			accountId: undefined,
			currency: undefined,
			trading: "enabled",
		});
	});
});
