// Records the error bodies Trading 212 really sends, which the spec does not document. Demo only.
//
//   T212_DEMO_API_KEY=... T212_DEMO_API_SECRET=... npm run fixtures:capture
//
// Optionally set T212_NARROW_API_KEY / T212_NARROW_API_SECRET to a demo key with only the "account" permission, to
// capture a missing-scope error too. Output goes to fixtures/errors.json with every credential redacted; read it
// before committing it.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { basicAuthorization } from "../src/config";
import { BASE_URLS } from "../src/environment";
import { createRedactor } from "../src/logging/redact";

const key = process.env.T212_DEMO_API_KEY;
const secret = process.env.T212_DEMO_API_SECRET;
if (!key || !secret) {
	console.error("Set T212_DEMO_API_KEY and T212_DEMO_API_SECRET. This script only ever talks to demo.");
	process.exit(1);
}
const narrowKey = process.env.T212_NARROW_API_KEY;
const narrowSecret = process.env.T212_NARROW_API_SECRET;
const redact = createRedactor([key, secret, narrowKey ?? "", narrowSecret ?? ""]);
const origin = BASE_URLS.demo;

interface Probe {
	name: string;
	method: string;
	path: string;
	authorization: string;
	body?: unknown;
}

const probes: Probe[] = [
	{
		name: "bad key",
		method: "GET",
		path: "/api/v0/equity/account/summary",
		authorization: basicAuthorization("not-a-key", "not-a-secret"),
	},
	{
		name: "missing order",
		method: "GET",
		path: "/api/v0/equity/orders/1",
		authorization: basicAuthorization(key, secret),
	},
	{
		name: "cancel missing order",
		method: "DELETE",
		path: "/api/v0/equity/orders/1",
		authorization: basicAuthorization(key, secret),
	},
	{
		name: "five decimal places",
		method: "POST",
		path: "/api/v0/equity/orders/limit",
		authorization: basicAuthorization(key, secret),
		body: { ticker: "AAPL_US_EQ", quantity: 0.12345, limitPrice: 1, timeValidity: "DAY" },
	},
	{
		name: "extended hours on a limit order",
		method: "POST",
		path: "/api/v0/equity/orders/limit",
		authorization: basicAuthorization(key, secret),
		body: { ticker: "AAPL_US_EQ", quantity: 0.1, limitPrice: 1, timeValidity: "DAY", extendedHours: true },
	},
	{
		name: "sell more than owned",
		method: "POST",
		path: "/api/v0/equity/orders/limit",
		authorization: basicAuthorization(key, secret),
		body: { ticker: "AAPL_US_EQ", quantity: -1_000_000, limitPrice: 100_000, timeValidity: "DAY" },
	},
	{
		name: "limit over 50",
		method: "GET",
		path: "/api/v0/equity/history/orders?limit=51",
		authorization: basicAuthorization(key, secret),
	},
	{
		name: "exports on demo",
		method: "GET",
		path: "/api/v0/equity/history/exports",
		authorization: basicAuthorization(key, secret),
	},
];
if (narrowKey && narrowSecret) {
	probes.push({
		name: "missing scope",
		method: "GET",
		path: "/api/v0/equity/positions",
		authorization: basicAuthorization(narrowKey, narrowSecret),
	});
}

const results = [];
for (const probe of probes) {
	const response = await fetch(`${origin}${probe.path}`, {
		method: probe.method,
		headers: {
			Authorization: probe.authorization,
			Accept: "application/json",
			...(probe.body !== undefined && { "Content-Type": "application/json" }),
		},
		...(probe.body !== undefined && { body: JSON.stringify(probe.body) }),
		redirect: "manual",
	});
	const text = await response.text();
	const headers: Record<string, string> = {};
	response.headers.forEach((value, name) => {
		if (name.startsWith("x-ratelimit") || name === "content-type") headers[name] = value;
	});
	results.push(
		redact({
			name: probe.name,
			request: `${probe.method} ${probe.path}`,
			status: response.status,
			headers,
			body: text,
		}),
	);
	console.log(`${response.status} ${probe.name}`);
	await new Promise((done) => setTimeout(done, 2500));
}

const out = resolve(import.meta.dirname, "../fixtures/errors.json");
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(
	out,
	`${JSON.stringify({ capturedAt: new Date().toISOString(), environment: "demo", results }, null, "\t")}\n`,
);
console.log(`\nWrote ${out}. Read it before committing: it should hold no account details.`);
