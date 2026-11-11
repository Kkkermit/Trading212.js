import { describe, expect, it } from "vitest";

import { readOnlyClient, runShow, type ShowCommand } from "../../src/cli/show";
import { createFakeTrading212, type FakeAccountState } from "../../src/testing";

const ENV = { T212_ENV: "demo", T212_API_KEY: "show-key-123456", T212_API_SECRET: "show-secret-abcdef" };

async function show(command: ShowCommand, options: { json?: boolean; state?: FakeAccountState; env?: object } = {}) {
	const fake = createFakeTrading212({ state: options.state ?? {}, client: { retry: false } });
	const out: string[] = [];
	const err: string[] = [];
	const code = await runShow({
		command,
		env: { ...ENV, ...options.env },
		json: options.json ?? false,
		write: (line) => out.push(line),
		writeError: (line) => err.push(line),
		createClient: () => fake.client,
	});
	return { code, out: out.join("\n"), err: err.join("\n"), server: fake.server };
}

describe("the read-only commands", () => {
	it("shows the account summary as a table", async () => {
		const { code, out } = await show("summary", { state: { cash: 1234.5 } });
		expect(code).toBe(0);
		expect(out).toContain("Account 12345678 on demo, in GBP");
		expect(out).toMatch(/Cash to trade\s+1,234\.50/);
		expect(out).toMatch(/Reserved for orders\s+0\.00/);
	});

	it("lists positions and pending orders in aligned columns, or says there are none", async () => {
		const positions = await show("positions", { state: { positions: [{ ticker: "AAPL_US_EQ", quantity: 2.5 }] } });
		expect(positions.out.split("\n")).toEqual([
			"Ticker      Quantity  Average price   Price   Value  Profit",
			"AAPL_US_EQ       2.5         230.00  230.00  575.00    0.00",
		]);
		expect((await show("positions")).out).toBe("No open positions.");
		expect((await show("orders")).out).toBe("No pending orders.");
	});

	it("lists a pending order with its prices", async () => {
		const fake = createFakeTrading212();
		await fake.client.orders.limit({ ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 200, timeValidity: "DAY" });
		const out: string[] = [];
		await runShow({
			command: "orders",
			env: ENV,
			write: (line) => out.push(line),
			writeError: () => undefined,
			createClient: () => fake.client,
		});
		expect(out[0]).toMatch(/^\s+ID\s+Ticker\s+Side\s+Type\s+Quantity\s+Filled\s+Limit\s+Stop\s+Status\s+Created$/);
		expect(out[1]).toMatch(/^1000000\s+AAPL_US_EQ\s+BUY\s+LIMIT\s+1\s+0\s+200\.00\s+-\s+NEW\s+\d{4}-/);
	});

	it("prints exactly what Trading 212 returned with --json", async () => {
		const { out } = await show("summary", { json: true });
		expect(JSON.parse(out)).toMatchObject({ id: 12345678, currency: "GBP" });
		expect(JSON.parse((await show("orders", { json: true })).out)).toEqual([]);
	});

	it("only reads, whatever it is asked", async () => {
		for (const command of ["summary", "positions", "orders"] as const) {
			const { server } = await show(command);
			expect(server.requests.every((request) => request.method === "GET")).toBe(true);
		}
	});

	it("explains a failure on stderr without printing the credentials", async () => {
		const fake = createFakeTrading212({ client: { retry: false } });
		fake.server.failNext("getAccountSummary", { status: 401, body: { message: `bad ${ENV.T212_API_SECRET}` } });
		const err: string[] = [];
		const code = await runShow({
			command: "summary",
			env: ENV,
			write: () => undefined,
			writeError: (line) => err.push(line),
			createClient: () => fake.client,
		});
		expect(code).toBe(1);
		expect(err.join("\n")).toContain("did not accept the API key and secret");
		expect(err.join("\n")).not.toContain(ENV.T212_API_SECRET);
	});

	it("builds a client that cannot trade, and reports settings it cannot use", async () => {
		expect(readOnlyClient(ENV).trading).toBe("disabled");
		const missing: string[] = [];
		const code = await runShow({
			command: "summary",
			env: { T212_ENV: "demo" },
			write: () => undefined,
			writeError: (line) => missing.push(line),
		});
		expect(code).toBe(1);
		expect(missing.join("\n")).toContain("T212_DEMO_API_KEY");
	});
});
