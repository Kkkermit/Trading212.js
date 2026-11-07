import { describe, expect, it } from "vitest";

import { runDoctor } from "../../src/cli/doctor";
import { createFakeTrading212 } from "../../src/testing";

const ENV = { T212_ENV: "demo", T212_API_KEY: "doctor-key-123456", T212_API_SECRET: "doctor-secret-abcdef" };

async function doctor(
	setup: (server: ReturnType<typeof createFakeTrading212>["server"]) => void = () => undefined,
	json = false,
) {
	const fake = createFakeTrading212({ client: { retry: false } });
	setup(fake.server);
	const lines: string[] = [];
	const code = await runDoctor({ env: ENV, json, write: (line) => lines.push(line), createClient: () => fake.client });
	return { code, output: lines.join("\n") };
}

describe("doctor", () => {
	it("signs in and reports every permission it can check", async () => {
		const { code, output } = await doctor();
		expect(code).toBe(0);
		expect(output).toContain("✓ settings: environment demo, key 17 characters, secret 20 characters");
		expect(output).toContain("✓ sign in: account 12345678 (GBP) on demo");
		expect(output).toContain("✓ portfolio: allowed");
		expect(output).toContain("· exports: live only");
		expect(output).toContain("· orders:execute: not checked");
		expect(output).toContain("✓ trading: orders can be placed on demo");
	});

	/** The doctor must never print a credential, whatever goes wrong. */
	it("never prints the key or secret", async () => {
		const { output } = await doctor((server) =>
			server.failNext("getAccountSummary", { status: 401, body: { message: ENV.T212_API_KEY } }),
		);
		expect(output).not.toContain(ENV.T212_API_KEY);
		expect(output).not.toContain(ENV.T212_API_SECRET);
	});

	it("names a missing permission and explains other failures", async () => {
		const { output } = await doctor((server) => {
			server.failNext("listPositions", { status: 403, body: { message: "Scope( portfolio ) missing for API key" } });
			server.failNext("listOrders", { status: 400, body: { code: "Odd" } });
			server.failNext("listReports", { status: 403, body: { message: "Scope( export ) missing for API key" } });
		});
		expect(output).toContain('✗ portfolio: not on this key (create one with "portfolio" ticked)');
		expect(output).toContain("⚠ orders:read: GET /api/v0/equity/orders failed with 400");
		expect(output).toContain("✗ exports: not on this key");
	});

	it("reports a failure to sign in with the reason, and stops", async () => {
		const { code, output } = await doctor((server) => server.failNext("getAccountSummary", { status: 401 }));
		expect(code).toBe(1);
		expect(output).toContain("✗ sign in:");
		expect(output).toContain("A key works in one environment only");
		expect(output).not.toContain("portfolio");
	});

	it("reports bad settings without asking anything", async () => {
		const lines: string[] = [];
		const code = await runDoctor({ env: {}, write: (line) => lines.push(line) });
		expect(code).toBe(1);
		expect(lines.join("\n")).toContain("T212_ENV is not set");
	});

	it("prints JSON, with colour off for machines", async () => {
		const { code, output } = await doctor((server) => server.failNext("listReports", { status: 500 }), true);
		const parsed = JSON.parse(output) as { ok: boolean; checks: { name: string; status: string }[] };
		expect(code).toBe(0);
		expect(parsed.ok).toBe(true);
		expect(parsed.checks.find((check) => check.name === "exports")?.status).toBe("warning");
	});

	it("colours its symbols in a terminal", async () => {
		const fake = createFakeTrading212();
		const lines: string[] = [];
		await runDoctor({ env: ENV, color: true, write: (line) => lines.push(line), createClient: () => fake.client });
		expect(lines.some((line) => line.includes("\u001b["))).toBe(true);
	});

	it("explains a failure that is not one of the library's errors", async () => {
		const lines: string[] = [];
		await runDoctor({
			env: ENV,
			write: (line) => lines.push(line),
			createClient: () => {
				// eslint-disable-next-line @typescript-eslint/only-throw-error -- checking a thrown non-error is described
				throw "not even an error";
			},
		});
		expect(lines.join("\n")).toContain("not even an error");
	});
});

describe("doctor settings", () => {
	it("reports settings once, after the client accepted them", async () => {
		const lines: string[] = [];
		const code = await runDoctor({
			env: { T212_ENV: "demo", T212_API_KEY: " padded-key-123456", T212_API_SECRET: "doctor-secret-abcdef" },
			write: (line) => lines.push(line),
		});
		expect(code).toBe(1);
		expect(lines.filter((line) => line.includes("settings"))).toEqual([
			expect.stringMatching(/^✗ settings: The API key starts or ends with whitespace/),
		]);
	});
});
