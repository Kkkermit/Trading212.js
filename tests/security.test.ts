import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import { basicAuthorization } from "../src/config";
import { Trading212Error } from "../src/errors/errors";
import { networkError, type RecordedRequest } from "../src/testing";

import { API_KEY, API_SECRET, memoryLogger, scripted } from "./helpers";

const ENCODED = basicAuthorization(API_KEY, API_SECRET).slice("Basic ".length);
const SECRETS = [API_KEY, API_SECRET, ENCODED];

function leaks(value: unknown): string[] {
	const text =
		typeof value === "string" ? value : `${inspect(value, { depth: 20, showHidden: true })}\n${JSON.stringify(value)}`;
	return SECRETS.filter((secret) => text.includes(secret));
}

/** Every walkable value reachable from an object, so a secret on any public property is found. */
function walk(root: unknown, seen = new Set<unknown>()): unknown[] {
	if (root === null || typeof root !== "object" || seen.has(root)) return [root];
	seen.add(root);
	const out: unknown[] = [root];
	for (const key of Reflect.ownKeys(root)) {
		const descriptor = Object.getOwnPropertyDescriptor(root, key);
		if (descriptor && "value" in descriptor) out.push(...walk(descriptor.value, seen));
	}
	return out;
}

// A hostile or buggy server that echoes the credentials back in every way it can.
const echo = (request: RecordedRequest) => ({
	status: 400,
	headers: { "x-debug": `Basic ${ENCODED}` },
	body: {
		code: "Echo",
		message: `You sent Basic ${ENCODED} with key ${API_KEY} and secret ${API_SECRET}`,
		authorization: `Basic ${ENCODED}`,
		traceId: `trace-${API_SECRET}`,
		nested: { apiSecret: API_SECRET, list: [API_KEY] },
		path: request.path,
	},
});

describe("credentials never leak", () => {
	it("from the client object, however it is printed or walked", () => {
		const { client } = scripted([]);
		expect(leaks(client)).toEqual([]);
		for (const value of walk(client)) expect(leaks(value)).toEqual([]);
	});

	/** The pattern that catches other Basic headers must not rewrite real data, such as a fund's name. */
	it("from a success body, without touching text that only looks like a credential", async () => {
		const name = "iShares U.S. Basic Materials ETF";
		const { client } = scripted([{ body: { id: 1, currency: `GBP ${API_SECRET}`, name } }]);
		const summary = (await client.account.summary()) as unknown as Record<string, unknown>;
		expect(leaks(summary)).toEqual([]);
		expect(summary.name).toBe(name);
	});

	it("from an error built on a response that echoes them", async () => {
		const { client } = scripted([echo]);
		const error = (await client.account.summary().catch((caught: unknown) => caught)) as Trading212Error;
		expect(error).toBeInstanceOf(Trading212Error);
		expect(error.traceId).toMatch(/^trace-/);
		for (const view of [error.message, error.stack ?? "", error.toLog(), error.body, error, JSON.stringify(error)]) {
			expect(leaks(view)).toEqual([]);
		}
	});

	/** A refusal's message is rewritten from the body and the order, so both routes in are checked. */
	it("from an order refusal that echoes them", async () => {
		const { client } = scripted([
			{
				status: 400,
				body: {
					type: "/api-errors/min-quantity-exceeded",
					detail: `must trade at least 2 ${API_SECRET}`,
					traceId: API_KEY,
				},
			},
		]);
		const error = (await client.orders
			.limit({ ticker: "AAPL_US_EQ", quantity: 1, limitPrice: 1, timeValidity: "DAY" })
			.catch((caught: unknown) => caught)) as Trading212Error & { minQuantity?: number };
		expect(error.minQuantity).toBe(2);
		for (const view of [error.message, error.toLog(), error]) expect(leaks(view)).toEqual([]);
	});

	it("from a body that was not JSON", async () => {
		const { client } = scripted([
			{ status: 200, body: `<html>${API_SECRET}</html>` },
			{ status: 500, body: `oops ${API_KEY}` },
		]);
		const notJson = await client.account.summary().catch((caught: unknown) => caught);
		expect(leaks(notJson)).toEqual([]);
		const plain = await scripted([{ status: 400, body: `bad ${API_KEY}` }])
			.client.account.summary()
			.catch((caught: unknown) => caught);
		expect(leaks(plain)).toEqual([]);
	});

	it("from log lines and hook events, through success, retry and failure", async () => {
		const { lines, logger } = memoryLogger();
		const events: unknown[] = [];
		const hooks = {
			onRequest: (event: unknown) => events.push(event),
			onResponse: (event: unknown) => events.push(event),
			onRetry: (event: unknown) => events.push(event),
			onRateLimitWait: (event: unknown) => events.push(event),
			onError: (event: unknown) => events.push(event),
		};
		const { client } = scripted([{ status: 503, body: { message: API_SECRET } }, { body: {} }, echo, networkError()], {
			logger,
			hooks,
		});
		await client.account.summary();
		await client.positions.list().catch(() => undefined);
		await client.orders.market({ ticker: "AAPL_US_EQ", quantity: 1 }).catch(() => undefined);
		expect(lines.length).toBeGreaterThan(3);
		expect(events.length).toBeGreaterThan(3);
		expect(events.filter((event) => (event as { error?: unknown }).error instanceof Trading212Error)).toHaveLength(3);
		expect(leaks(lines)).toEqual([]);
		expect(leaks(events)).toEqual([]);
	});

	it("from the requests a test records", async () => {
		const { client, requests } = scripted([{ body: {} }]);
		await client.account.summary();
		expect(leaks(requests)).toEqual([]);
		expect(requests[0]?.authorized).toBe(true);
	});
});

describe("credentials only go to Trading 212", () => {
	it("send every authenticated request to the configured origin", async () => {
		const { client, requests } = scripted([
			{ body: { items: [{}], nextPagePath: "/api/v0/equity/history/orders?cursor=2&limit=1" } },
			{ body: { items: [{}], nextPagePath: null } },
		]);
		await Array.fromAsync(client.history.orders.all({ pageSize: 1 }));
		expect(requests.map((request) => new URL(request.url).origin)).toEqual([
			"https://demo.trading212.com",
			"https://demo.trading212.com",
		]);
	});

	it("send no credentials to a report's signed link", async () => {
		const { client, requests } = scripted([{ body: "csv" }]);
		await client.reports.download("https://storage.example/report.csv?signature=x");
		expect(requests[0]?.authorized).toBe(false);
	});
});

describe("credentials near the cut-off of a long body", () => {
	/** Cutting before redacting would leave most of a secret that straddled the cut. */
	it("redacts before it truncates", async () => {
		const prefix = API_SECRET.slice(0, 12);
		const longError = `${"x".repeat(64 * 1024 - 8)}${API_SECRET}`;
		const longPage = `${"y".repeat(2000 - 8)}${API_SECRET}`;
		const { client } = scripted([
			{ status: 400, body: longError },
			{ status: 200, body: longPage },
		]);
		const error = await client.account.summary().catch((caught: unknown) => caught);
		const notJson = await client.account.summary().catch((caught: unknown) => caught);
		for (const view of [error, notJson]) expect(JSON.stringify(view)).not.toContain(prefix);
	});
});
