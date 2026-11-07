import { describe, expect, it } from "vitest";

import { networkError, scriptedFetch } from "../../src/testing";
import { recordRequest, toResponse } from "../../src/testing/scriptedFetch";

describe("scriptedFetch", () => {
	it("answers in order, records requests without the Authorization value, and runs functions", async () => {
		const { fetch, requests, pending } = scriptedFetch([
			{ body: { ok: true } },
			(request) => ({ status: 201, body: request.query }),
			networkError("ECONNRESET"),
			() => new Error("from a function"),
		]);
		const first = await fetch("https://x.example/a", { headers: { Authorization: "Basic abc" } });
		expect(await first.json()).toEqual({ ok: true });
		const second = await fetch("https://x.example/b?q=1", { method: "POST", body: '{"a":1}' });
		expect(second.status).toBe(201);
		expect(await second.json()).toEqual({ q: "1" });
		await expect(fetch("https://x.example/c", {})).rejects.toThrow("fetch failed");
		await expect(fetch("https://x.example/d", {})).rejects.toThrow("from a function");
		await expect(fetch("https://x.example/e", {})).rejects.toThrow("no response left for GET /e");
		expect(pending()).toBe(0);
		expect(requests[0]).toMatchObject({ authorized: true, headers: { authorization: "[REDACTED]" } });
		expect(requests[1]).toMatchObject({ method: "POST", body: { a: 1 }, authorized: false });
	});

	it("refuses to answer an aborted request", async () => {
		const { fetch } = scriptedFetch([{ body: {} }]);
		await expect(fetch("https://x.example", { signal: AbortSignal.abort(new Error("gone")) })).rejects.toThrow("gone");
	});

	it("builds responses the way Trading 212 sends them", async () => {
		expect(await toResponse({ body: "plain" }).text()).toBe("plain");
		expect(toResponse({ status: 204, body: "ignored" }).status).toBe(204);
		expect(toResponse({ status: 418 }).statusText).toBe("");
		expect(toResponse({ body: {}, headers: { "content-type": "text/x" } }).headers.get("content-type")).toBe("text/x");
		const recorded = await recordRequest("https://x.example/p", { method: "PUT", body: "not json" });
		expect(recorded.body).toBe("not json");
		const streamed = await recordRequest("https://x.example/p", { method: "PUT", body: new Blob(["blob"]) });
		expect(streamed.body).toBe("blob");
	});
});
