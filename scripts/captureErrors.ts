// Records the error bodies Trading 212 really sends, which the spec does not document. Demo only.
//
//   T212_DEMO_API_KEY=... T212_DEMO_API_SECRET=... npm run fixtures:capture
//
// The two variables can also go in .env; anything already set in the shell wins.
//
// Optionally set T212_NARROW_API_KEY / T212_NARROW_API_SECRET to a demo key with only the "account" permission, to
// capture a missing-scope error too. Every order a probe sends is priced so it cannot fill, and any that demo accepts
// is cancelled at once. Output goes to fixtures/errors.json with every credential redacted; read it before
// committing it.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { basicAuthorization } from "../src/config";
import { BASE_URLS } from "../src/environment";
import { createRedactor } from "../src/logging/redact";

const envFile = resolve(import.meta.dirname, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const key = process.env.T212_DEMO_API_KEY;
const secret = process.env.T212_DEMO_API_SECRET;
if (!key || !secret) {
	console.error(
		"Set T212_DEMO_API_KEY and T212_DEMO_API_SECRET, in your shell or in .env. This script only ever talks to demo.",
	);
	process.exit(1);
}
const narrowKey = process.env.T212_NARROW_API_KEY;
const narrowSecret = process.env.T212_NARROW_API_SECRET;
const redact = createRedactor([key, secret, narrowKey ?? "", narrowSecret ?? ""]);
const origin = BASE_URLS.demo;
const authorization = basicAuthorization(key, secret);
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface Probe {
	name: string;
	method: string;
	path: string;
	authorization?: string;
	body?: unknown;
	/** Send the request twice at once and record the second answer, to meet the rate limit. */
	twice?: boolean;
}

async function send(probe: Probe): Promise<{ response: Response; text: string }> {
	const response = await fetch(`${origin}${probe.path}`, {
		method: probe.method,
		headers: {
			Authorization: probe.authorization ?? authorization,
			Accept: "application/json",
			...(probe.body !== undefined && { "Content-Type": "application/json" }),
		},
		...(probe.body !== undefined && { body: JSON.stringify(probe.body) }),
		redirect: "manual",
	});
	return { response, text: await response.text() };
}

// The free cash decides how many $1 shares are more than the account can pay for; it is never recorded.
const summary = await send({ name: "summary", method: "GET", path: "/api/v0/equity/account/summary" });
const free = summary.response.ok
	? Number((JSON.parse(summary.text) as { cash?: { availableToTrade?: number } }).cash?.availableToTrade)
	: Number.NaN;
// 30,000 shares at a price costing about three times the free cash, and far below the market so it cannot fill.
const unaffordablePrice = Number.isFinite(free) ? Math.max(1, Math.ceil((Math.max(free, 1) * 3) / 30_000)) : undefined;
await pause(5500);

const limitOrder = (quantity: number, limitPrice: number, extra: Record<string, unknown> = {}) => ({
	ticker: "AAPL_US_EQ",
	quantity,
	limitPrice,
	timeValidity: "DAY",
	...extra,
});

const probes: Probe[] = [
	{
		name: "bad key",
		method: "GET",
		path: "/api/v0/equity/account/summary",
		authorization: basicAuthorization("not-a-key", "not-a-secret"),
	},
	{ name: "missing order", method: "GET", path: "/api/v0/equity/orders/1" },
	{ name: "cancel missing order", method: "DELETE", path: "/api/v0/equity/orders/1" },
	{ name: "below the minimum quantity", method: "POST", path: "/api/v0/equity/orders/limit", body: limitOrder(0.1, 1) },
	{
		name: "five decimal places",
		method: "POST",
		path: "/api/v0/equity/orders/limit",
		body: limitOrder(5.12345, 1),
	},
	{
		name: "extended hours on a limit order",
		method: "POST",
		path: "/api/v0/equity/orders/limit",
		body: limitOrder(5, 1, { extendedHours: true }),
	},
	{
		name: "above the maximum quantity",
		method: "POST",
		path: "/api/v0/equity/orders/limit",
		body: limitOrder(-1_000_000, 100_000),
	},
	// A sell far above the market, within the 32,880-share maximum demo gave for one order.
	{
		name: "sell more than owned",
		method: "POST",
		path: "/api/v0/equity/orders/limit",
		body: limitOrder(-1000, 100_000),
	},
	...(unaffordablePrice !== undefined && unaffordablePrice <= 50
		? [
				{
					name: "buy more than the cash allows",
					method: "POST",
					path: "/api/v0/equity/orders/limit",
					body: limitOrder(30_000, unaffordablePrice),
				},
			]
		: []),
	{ name: "limit over 50", method: "GET", path: "/api/v0/equity/history/orders?limit=51" },
	{ name: "too many requests", method: "GET", path: "/api/v0/equity/orders/1", twice: true },
	{ name: "exports on demo", method: "GET", path: "/api/v0/equity/history/exports" },
];
if (narrowKey && narrowSecret) {
	probes.push({
		name: "missing scope",
		method: "GET",
		path: "/api/v0/equity/positions",
		authorization: basicAuthorization(narrowKey, narrowSecret),
	});
}
if (unaffordablePrice === undefined || unaffordablePrice > 50) {
	console.log("Skipped buy more than the cash allows: the free cash could not be read, or is too large to test.");
}

function idOf(text: string): unknown {
	try {
		return (JSON.parse(text) as { id?: unknown }).id;
	} catch {
		return undefined;
	}
}

const results = [];
for (const probe of probes) {
	if (probe.twice) await send(probe);
	let { response, text } = await send(probe);
	// Once a minute is all the exports endpoint allows, so a run straight after `npm run test:demo` waits its turn.
	if (response.status === 429 && !probe.twice) {
		console.log(`429 ${probe.name}: waiting a minute to try again`);
		await pause(61_000);
		({ response, text } = await send(probe));
	}
	const headers: Record<string, string> = {};
	response.headers.forEach((value, name) => {
		if (name.startsWith("x-ratelimit") || name === "content-type" || name === "retry-after") headers[name] = value;
	});
	results.push(
		redact({
			name: probe.name,
			request: `${probe.method} ${probe.path}`,
			...(probe.body !== undefined && { sent: probe.body }),
			status: response.status,
			headers,
			body: text,
		}),
	);
	console.log(`${response.status} ${probe.name}`);
	const placed = probe.method === "POST" && response.ok ? idOf(text) : undefined;
	if (typeof placed === "number") {
		await pause(1500);
		const cancelled = await send({ name: "cancel", method: "DELETE", path: `/api/v0/equity/orders/${placed}` });
		console.log(`    demo accepted it as order ${placed}; cancelling it answered ${cancelled.response.status}`);
	}
	await pause(2500);
}

const out = resolve(import.meta.dirname, "../fixtures/errors.json");
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(
	out,
	`${JSON.stringify({ capturedAt: new Date().toISOString(), environment: "demo", results }, null, "\t")}\n`,
);
console.log(`\nWrote ${out}. Read it before committing: it should hold no account details.`);
