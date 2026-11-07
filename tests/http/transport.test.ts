import { describe, expect, it, vi } from "vitest";

import {
	NetworkError,
	OrderOutcomeUnknownError,
	RateLimitError,
	ServerError,
	TimeoutError,
	TradingDisabledError,
	UnexpectedResponseError,
	ValidationError,
} from "../../src/errors/errors";
import { buildPath } from "../../src/http/transport";
import { networkError } from "../../src/testing/scriptedFetch";
import { API_KEY, API_SECRET, hangingFetch, memoryLogger, scripted } from "../helpers";

const SUMMARY = { id: 1, currency: "GBP", totalValue: 10 };
const ORDER = { ticker: "AAPL_US_EQ", quantity: 1 };

describe("requests", () => {
	it("sends Basic credentials, JSON headers and a user agent to the right URL", async () => {
		const { client, requests } = scripted([{ body: SUMMARY }]);
		await client.account.summary();
		expect(requests[0]).toMatchObject({
			method: "GET",
			url: "https://demo.trading212.com/api/v0/equity/account/summary",
			authorized: true,
			headers: { accept: "application/json", "user-agent": expect.stringMatching(/^trading212\.js\//) },
		});
	});

	it("sends a JSON body with a content type", async () => {
		const { client, requests } = scripted([{ body: { id: 9, status: "NEW" } }]);
		await client.orders.market(ORDER);
		expect(requests[0]?.headers["content-type"]).toBe("application/json");
		expect(requests[0]?.body).toEqual(ORDER);
	});

	it("appends the caller's user agent", async () => {
		const { client, requests } = scripted([{ body: SUMMARY }], { userAgent: "my-bot/2" });
		await client.account.summary();
		expect(requests[0]?.headers["user-agent"]).toMatch(/ my-bot\/2$/);
	});

	it("treats an empty success body as undefined, and rejects one that is not JSON", async () => {
		const { client } = scripted([{ status: 200 }, { body: "<html>oops</html>" }]);
		await expect(client.orders.cancel(5)).resolves.toBeUndefined();
		await expect(client.account.summary()).rejects.toBeInstanceOf(UnexpectedResponseError);
	});

	/** Following a redirect would send the credentials wherever it points. */
	it("refuses redirects", async () => {
		const { client } = scripted([{ status: 302, headers: { location: "https://evil.example" } }]);
		await expect(client.account.summary()).rejects.toThrow("never followed");
	});

	it("tells fetch never to follow a redirect itself", async () => {
		const seen: RequestInit[] = [];
		const { client } = scripted([], {
			fetch: (_input, init) => {
				seen.push(init);
				return Promise.resolve(new Response("{}", { status: 200 }));
			},
		});
		await client.account.summary();
		expect(seen[0]?.redirect).toBe("manual");
	});

	it("encodes path parameters and refuses a missing one", () => {
		expect(buildPath("/a/{id}", { id: "x/y" })).toBe("/a/x%2Fy");
		expect(() => buildPath("/a/{id}")).toThrow(ValidationError);
	});
});

describe("retries", () => {
	it("retries a read after a server error, then succeeds", async () => {
		const { client, requests } = scripted([{ status: 503 }, { status: 502 }, { body: SUMMARY }]);
		await expect(client.account.summary()).resolves.toEqual(SUMMARY);
		expect(requests).toHaveLength(3);
	});

	it("gives up after maxAttempts", async () => {
		const { client, requests } = scripted([{ status: 500 }, { status: 500 }], {
			retry: { maxAttempts: 2, baseDelayMs: 1 },
		});
		await expect(client.account.summary()).rejects.toBeInstanceOf(ServerError);
		expect(requests).toHaveLength(2);
	});

	it("does not retry when retries are off, or for a client error", async () => {
		const off = scripted([{ status: 500 }], { retry: false });
		await expect(off.client.account.summary()).rejects.toBeInstanceOf(ServerError);
		const bad = scripted([{ status: 400 }]);
		await expect(bad.client.account.summary()).rejects.toBeInstanceOf(ValidationError);
		expect(bad.requests).toHaveLength(1);
	});

	it("retries after a 429 once its reset has passed, and marks the budget spent", async () => {
		const resetSoon = String(Math.floor(Date.now() / 1000) - 1);
		const { client, requests } = scripted([
			{ status: 429, headers: { "x-ratelimit-reset": resetSoon, "x-ratelimit-remaining": "0" } },
			{ body: SUMMARY },
		]);
		await expect(client.account.summary()).resolves.toEqual(SUMMARY);
		expect(requests).toHaveLength(2);
	});

	it("does not retry a 429 whose reset is further away than it may wait", async () => {
		const resetLater = String(Math.floor(Date.now() / 1000) + 3600);
		const { client, requests } = scripted([{ status: 429, headers: { "x-ratelimit-reset": resetLater } }]);
		await expect(client.account.summary()).rejects.toBeInstanceOf(RateLimitError);
		expect(requests).toHaveLength(1);
	});

	/** A duplicate order is the worst thing this library could do. */
	it("never retries a trade", async () => {
		const { client, requests } = scripted([{ status: 503 }, { body: {} }]);
		await expect(client.orders.market(ORDER)).rejects.toBeInstanceOf(OrderOutcomeUnknownError);
		expect(requests).toHaveLength(1);
	});

	it("reports retries through hooks and the logger", async () => {
		const { lines, logger } = memoryLogger();
		const onRetry = vi.fn();
		const { client } = scripted([{ status: 500 }, { body: SUMMARY }], { logger, hooks: { onRetry } });
		await client.account.summary();
		expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "getAccountSummary", attempt: 1 }));
		expect(lines.some((line) => line.level === "warn" && line.message.startsWith("Retrying"))).toBe(true);
	});
});

describe("network failures", () => {
	it("says a read could not connect, and retries it", async () => {
		const { client, requests } = scripted([
			networkError("ENOTFOUND"),
			networkError("ENOTFOUND"),
			networkError("ENOTFOUND"),
		]);
		const error = (await client.account.summary().catch((caught: unknown) => caught)) as NetworkError;
		expect(error).toBeInstanceOf(NetworkError);
		expect(error.sent).toBe(false);
		expect(error.hint).toContain("Nothing was sent");
		expect(requests).toHaveLength(3);
	});

	/** A connection that never opened cannot have placed an order, so the caller may safely try again. */
	it("tells a trade that never left from one that may have run", async () => {
		const refused = scripted([networkError("ECONNREFUSED")]);
		const notSent = (await refused.client.orders.market(ORDER).catch((caught: unknown) => caught)) as NetworkError;
		expect(notSent).toBeInstanceOf(NetworkError);
		expect(notSent.sent).toBe(false);

		const reset = scripted([networkError("ECONNRESET")]);
		const unknown = (await reset.client.orders
			.market(ORDER)
			.catch((caught: unknown) => caught)) as OrderOutcomeUnknownError;
		expect(unknown).toBeInstanceOf(OrderOutcomeUnknownError);
		expect(unknown.sent).toEqual(ORDER);
		expect(unknown.message).toContain("ECONNRESET");

		const noCode = scripted([new TypeError("fetch failed")]);
		await expect(noCode.client.account.summary()).rejects.toBeInstanceOf(NetworkError);
	});

	it("times out a read, and reports a trade that timed out as an unknown outcome", async () => {
		const read = scripted([], { fetch: hangingFetch(), timeoutMs: 20, retry: false });
		await expect(read.client.account.summary()).rejects.toBeInstanceOf(TimeoutError);
		const trade = scripted([], { fetch: hangingFetch(), timeoutMs: 20 });
		await expect(trade.client.orders.market(ORDER)).rejects.toBeInstanceOf(OrderOutcomeUnknownError);
		const write = scripted([], { fetch: hangingFetch(), timeoutMs: 20 });
		await expect(write.client.reports.request({ from: "2026-01-01", to: "2026-02-01" })).rejects.toBeInstanceOf(
			TimeoutError,
		);
	});

	it("honours a per-call timeout", async () => {
		const { client } = scripted([], { fetch: hangingFetch(), retry: false });
		await expect(client.account.summary({ timeoutMs: 15 })).rejects.toThrow("within 15 ms");
	});

	it("rethrows the caller's abort for a read, and for a trade aborted before sending", async () => {
		const controller = new AbortController();
		const { client } = scripted([], { fetch: hangingFetch() });
		const pending = client.account.summary({ signal: controller.signal });
		controller.abort(new Error("stop"));
		await expect(pending).rejects.toThrow("stop");

		const aborted = AbortSignal.abort(new Error("already"));
		const before = scripted([{ body: {} }]);
		await expect(before.client.orders.market(ORDER, { signal: aborted })).rejects.toThrow("already");
		expect(before.requests).toHaveLength(0);
	});

	it("reports a trade aborted after it was sent as an unknown outcome", async () => {
		const controller = new AbortController();
		const { client } = scripted([], { fetch: hangingFetch() });
		const pending = client.orders.market(ORDER, { signal: controller.signal });
		setTimeout(() => {
			controller.abort(new Error("changed my mind"));
		}, 5);
		await expect(pending).rejects.toBeInstanceOf(OrderOutcomeUnknownError);
	});

	it("reports a trade whose response body could not be read as an unknown outcome", async () => {
		const broken = new Response(
			new ReadableStream({
				pull: (controller) => {
					controller.error(new Error("cut"));
				},
			}),
			{ status: 200 },
		);
		const { client } = scripted([], { fetch: () => Promise.resolve(broken) });
		await expect(client.orders.market(ORDER)).rejects.toBeInstanceOf(OrderOutcomeUnknownError);
	});
});

describe("live safety", () => {
	/** The check runs before anything is sent, so no request reaches the network. */
	it("refuses a trade on live unless trading is enabled", async () => {
		const { client, requests } = scripted([{ body: {} }], { environment: "live" });
		const error = await client.orders.market(ORDER).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(TradingDisabledError);
		expect((error as TradingDisabledError).hint).toContain('trading: "enabled"');
		expect(requests).toHaveLength(0);
		expect(client.trading).toBe("disabled");
	});

	it("still lets a live client read, and request reports", async () => {
		const { client } = scripted([{ body: SUMMARY }, { body: { reportId: 3 } }], { environment: "live" });
		await expect(client.account.summary()).resolves.toEqual(SUMMARY);
		await expect(client.reports.request({ from: "2026-01-01", to: "2026-02-01" })).resolves.toBe(3);
	});

	it("places trades on live once enabled", async () => {
		const { client, requests } = scripted([{ body: { id: 1 } }], { environment: "live", trading: "enabled" });
		await client.orders.market(ORDER);
		expect(requests[0]?.url).toBe("https://live.trading212.com/api/v0/equity/orders/market");
	});
});

describe("rate limits in the transport", () => {
	it("throws instead of waiting longer than allowed", async () => {
		const { client, requests } = scripted([{ body: SUMMARY }, { body: SUMMARY }], {
			rateLimit: "pace",
			maxRateLimitWaitMs: 100,
		});
		await client.account.summary();
		const error = (await client.account.summary().catch((caught: unknown) => caught)) as RateLimitError;
		expect(error).toBeInstanceOf(RateLimitError);
		expect(error.retryAfterMs).toBeGreaterThan(4000);
		expect(requests).toHaveLength(1);
	});

	it("waits for budget and reports the wait", async () => {
		const onRateLimitWait = vi.fn();
		const { lines, logger } = memoryLogger();
		const { client } = scripted([{ body: [] }, { body: [] }], {
			rateLimit: "pace",
			hooks: { onRateLimitWait },
			logger,
		});
		await client.positions.list();
		await client.positions.list();
		expect(onRateLimitWait).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "listPositions" }));
		expect(lines.some((line) => line.message.includes("rate limit"))).toBe(true);
	});

	it("warns when a wait is long", async () => {
		vi.useFakeTimers();
		try {
			const { lines, logger } = memoryLogger();
			const { client } = scripted([{ body: SUMMARY }, { body: SUMMARY }], { rateLimit: "pace", logger });
			await client.account.summary();
			const second = client.account.summary();
			await vi.advanceTimersByTimeAsync(5000);
			await second;
			expect(lines.some((line) => line.level === "warn" && line.message.startsWith("Waiting"))).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("shares budget between two clients for the same key", () => {
		const first = scripted([], { rateLimit: "pace" }).client;
		const second = scripted([], { rateLimit: "pace" }).client;
		expect(first.rateLimits().getAccountSummary).toEqual(second.rateLimits().getAccountSummary);
	});
});

describe("hooks and logging", () => {
	it("calls the request and response hooks with safe fields, ignoring a hook that throws", async () => {
		const onRequest = vi.fn(() => {
			throw new Error("bad hook");
		});
		const onResponse = vi.fn();
		const { client } = scripted([{ body: SUMMARY }], { hooks: { onRequest, onResponse } });
		await expect(client.account.summary()).resolves.toEqual(SUMMARY);
		expect(onRequest).toHaveBeenCalledWith({
			endpoint: "getAccountSummary",
			method: "GET",
			path: "/api/v0/equity/account/summary",
			attempt: 1,
		});
		expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 200, durationMs: expect.any(Number) }));
	});

	it("logs each request and response at debug", async () => {
		const { lines, logger } = memoryLogger();
		const { client } = scripted([{ body: SUMMARY }], { logger });
		await client.account.summary();
		expect(lines.map((line) => line.level)).toEqual(["debug", "debug"]);
		expect(lines[1]?.fields).toMatchObject({ status: 200, endpoint: "getAccountSummary" });
	});

	it("warns once per deprecated endpoint", async () => {
		const { lines, logger } = memoryLogger();
		const { client } = scripted([{ body: [] }, { body: [] }], { logger });
		await client.pies.list();
		await client.pies.list();
		expect(lines.filter((line) => line.level === "warn")).toHaveLength(1);
	});

	it("is quiet by default", async () => {
		const spy = vi.spyOn(console, "debug");
		const { client } = scripted([{ body: SUMMARY }]);
		await client.account.summary();
		expect(spy).not.toHaveBeenCalled();
	});
});

it("uses the key and secret given", () => {
	expect(API_KEY).not.toBe(API_SECRET);
});
