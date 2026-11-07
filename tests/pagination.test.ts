import { describe, expect, it } from "vitest";

import { RateLimitError, Trading212Error, UnexpectedResponseError, ValidationError } from "../src/errors/errors";
import { ENDPOINTS } from "../src/http/endpoints.generated";
import { nextPageQuery } from "../src/pagination";

import { scripted } from "./helpers";

const ORIGIN = "https://demo.trading212.com";
const ORDERS = ENDPOINTS.listHistoricalOrders;
const page = (ids: number[], nextPagePath: string | null) => ({
	body: { items: ids.map((id) => ({ order: { id } })), nextPagePath },
});

describe("nextPageQuery", () => {
	it("follows the documented full path", () => {
		expect(nextPageQuery("/api/v0/equity/history/orders?limit=2&cursor=1760346100000", ORDERS, ORIGIN)).toBe(
			"limit=2&cursor=1760346100000",
		);
	});

	it("accepts a bare query string, with or without its question mark", () => {
		expect(nextPageQuery("limit=2&cursor=5", ORDERS, ORIGIN)).toBe("limit=2&cursor=5");
		expect(nextPageQuery("?limit=2&cursor=5", ORDERS, ORIGIN)).toBe("limit=2&cursor=5");
	});

	it("treats every form of 'no more' as the end", () => {
		for (const end of [null, undefined, "", "  ", "null", "null&limit=2", "null?x", "/api/v0/equity/history/orders"]) {
			expect(nextPageQuery(end, ORDERS, ORIGIN), String(end)).toBeNull();
		}
	});

	/** The next request carries the credentials, so a path that leaves the endpoint is never followed. */
	it("refuses a path that points anywhere else", () => {
		for (const hostile of [
			"//evil.example/api/v0/equity/history/orders?cursor=1",
			"https://evil.example/api/v0/equity/history/orders?cursor=1",
			"/api/v0/equity/history/../../orders?cursor=1",
			"/api/v0/equity/history/dividends?cursor=1",
			"/api/v0/equity/history/orders\\..\\x?cursor=1",
			"http://[::1",
		]) {
			expect(() => nextPageQuery(hostile, ORDERS, ORIGIN), hostile).toThrow(UnexpectedResponseError);
		}
	});
});

describe("PagedList", () => {
	it("fetches one page with filters and a limit", async () => {
		const { client, requests } = scripted([
			page([1, 2], "/api/v0/equity/history/orders?limit=2&cursor=9&ticker=AAPL_US_EQ"),
		]);
		const first = await client.history.orders.list({ ticker: "AAPL_US_EQ", limit: 2 });
		expect(first.items.map((item) => item.order?.id)).toEqual([1, 2]);
		expect(first.hasMore).toBe(true);
		expect(first.nextCursor).toBe("limit=2&cursor=9&ticker=AAPL_US_EQ");
		expect(requests[0]?.query).toEqual({ ticker: "AAPL_US_EQ", limit: "2" });
	});

	it("walks to the end with next()", async () => {
		const { client, requests } = scripted([page([1], "limit=1&cursor=2"), page([2], null)]);
		const first = await client.history.orders.list({ limit: 1 });
		const second = await first.next();
		expect(second?.items.map((item) => item.order?.id)).toEqual([2]);
		expect(second?.hasMore).toBe(false);
		await expect(second?.next()).resolves.toBeNull();
		expect(requests[1]?.query).toEqual({ limit: "1", cursor: "2" });
	});

	it("resumes from a saved cursor", async () => {
		const { client, requests } = scripted([page([7], null)]);
		await client.history.dividends.list({ cursor: "limit=5&cursor=123" });
		expect(requests[0]?.query).toEqual({ limit: "5", cursor: "123" });
	});

	it("refuses a cursor it did not make", async () => {
		const { client } = scripted([]);
		await expect(
			client.history.orders.list({ cursor: "/api/v0/equity/history/orders?cursor=1" }),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(client.history.orders.list({ cursor: "null" })).rejects.toBeInstanceOf(ValidationError);
	});

	it("checks the limit before asking", async () => {
		const { client, requests } = scripted([]);
		for (const limit of [0, 51, 1.5])
			await expect(client.history.orders.list({ limit })).rejects.toBeInstanceOf(ValidationError);
		expect(requests).toHaveLength(0);
	});

	it("tolerates a missing items array", async () => {
		const { client } = scripted([{ body: { nextPagePath: null } }, { status: 200 }]);
		expect((await client.history.transactions.list()).items).toEqual([]);
		expect((await client.history.transactions.list()).items).toEqual([]);
	});

	it("iterates every item across pages, 50 at a time", async () => {
		const { client, requests } = scripted([page([1, 2], "limit=50&cursor=3"), page([3], null)]);
		const ids = [];
		for await (const item of client.history.orders.all()) ids.push(item.order?.id);
		expect(ids).toEqual([1, 2, 3]);
		expect(requests[0]?.query).toEqual({ limit: "50" });
	});

	it("stops at maxItems or maxPages", async () => {
		const items = scripted([page([1, 2, 3], "limit=50&cursor=4")]);
		expect((await Array.fromAsync(items.client.history.orders.all({ maxItems: 2 }))).length).toBe(2);
		const pages = scripted([page([1], "limit=50&cursor=2"), page([2], "limit=50&cursor=3")]);
		expect((await Array.fromAsync(pages.client.history.orders.all({ maxPages: 2 }))).length).toBe(2);
		expect(pages.requests).toHaveLength(2);
	});

	/** A long history can outlast the rate limit; the error must say where to carry on. */
	it("puts the cursor to resume from on an error part-way through", async () => {
		const { client } = scripted([page([1], "limit=50&cursor=2"), { status: 400, body: { code: "Nope" } }]);
		const seen: unknown[] = [];
		const error = await (async () => {
			for await (const item of client.history.orders.all()) seen.push(item.order?.id);
		})().catch((caught: unknown) => caught);
		expect(seen).toEqual([1]);
		expect(error).toBeInstanceOf(Trading212Error);
		expect((error as Trading212Error).resumeCursor).toBe("limit=50&cursor=2");
	});

	it("puts the starting cursor on an error from the first page", async () => {
		const { client } = scripted([{ status: 429, headers: { "x-ratelimit-reset": "9999999999" } }]);
		const error = await Array.fromAsync(client.history.orders.all({ cursor: "limit=50&cursor=8" })).catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(RateLimitError);
		expect((error as RateLimitError).resumeCursor).toBe("limit=50&cursor=8");
		const fresh = scripted([{ status: 400 }]);
		const noCursor = await Array.fromAsync(fresh.client.history.orders.all()).catch((caught: unknown) => caught);
		expect((noCursor as Trading212Error).resumeCursor).toBeUndefined();
	});

	it("passes dates and numbers as query values", async () => {
		const { client, requests } = scripted([page([], null)]);
		await client.history.transactions.list({ limit: 3, signal: new AbortController().signal, timeoutMs: 5000 });
		expect(requests[0]?.query).toEqual({ limit: "3" });
	});
});

describe("PagedList against a misbehaving server", () => {
	it("stops with an error when the same next page comes back twice", async () => {
		const looping = { body: { items: [{}], nextPagePath: "limit=50&cursor=5" } };
		const { client, requests } = scripted([looping, looping, looping, looping]);
		await expect(Array.fromAsync(client.history.orders.all())).rejects.toThrow("returned the same next page");
		expect(requests).toHaveLength(2);
	});

	it("keeps the caller's timeout for every page, not just the first", async () => {
		let calls = 0;
		const fetch = (_input: string, init: RequestInit): Promise<Response> => {
			calls++;
			if (calls === 1) return Promise.resolve(Response.json({ items: [{}], nextPagePath: "limit=50&cursor=2" }));
			return new Promise((_resolve, reject) => {
				init.signal?.addEventListener("abort", () => {
					reject(init.signal?.reason as Error);
				});
			});
		};
		const { client } = scripted([], { fetch, retry: false });
		await expect(Array.fromAsync(client.history.orders.all({ timeoutMs: 20 }))).rejects.toThrow("within 20 ms");
	});
});
