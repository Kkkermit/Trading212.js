import { describe, expect, it } from "vitest";

import { Trading212 } from "../../src/client";
import { NetworkError, NotAvailableInDemoError, TimeoutError, UnexpectedResponseError } from "../../src/errors/errors";
import { FAKE_API_KEY, FAKE_API_SECRET, FakeTrading212Server } from "../../src/testing";
import { createFakeTrading212 } from "../../src/testing";

import { scripted } from "../helpers";

describe("reports", () => {
	it("requests, waits for and downloads a report without sending credentials", async () => {
		const { client, server } = createFakeTrading212({ environment: "live" });
		await client.orders.buy({ ticker: "AAPL_US_EQ", quantity: 1 });
		const statuses: unknown[] = [];
		const { report, csv } = await client.reports.export(
			{ from: new Date("2026-01-01"), to: "2026-12-31", include: { interest: false } },
			{ intervalMs: 1, onStatus: (current) => statuses.push(current.status) },
		);
		expect(statuses).toEqual(["Queued", "Finished"]);
		expect(report.downloadLink).toMatch(/^https:\/\/reports\.fake-trading212\.invalid\//);
		expect(csv.split("\n")[1]).toContain("AAPL_US_EQ");
		expect(
			server.requests.find((request) => request.path.endsWith("/exports") && request.method === "POST")?.body,
		).toEqual({
			timeFrom: "2026-01-01T00:00:00.000Z",
			timeTo: "2026-12-31T00:00:00.000Z",
			dataIncluded: { includeDividends: true, includeInterest: false, includeOrders: true, includeTransactions: true },
		});
	});

	it("refuses bad dates before asking", async () => {
		const { client, server } = createFakeTrading212({ environment: "live" });
		await expect(client.reports.request({ from: "garbage", to: "2026-01-01" })).rejects.toThrow(
			"from is not a valid date",
		);
		await expect(client.reports.request({ from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow(
			"from must be before to",
		);
		expect(server.requests).toHaveLength(0);
	});

	it("explains that exports are live only", async () => {
		const { client } = createFakeTrading212();
		const error = (await client.reports.list().catch((caught: unknown) => caught)) as NotAvailableInDemoError;
		expect(error).toBeInstanceOf(NotAvailableInDemoError);
		expect(error.hint).toContain("live only");
	});

	it("lets the fake offer exports on demo when asked", async () => {
		const { client, server } = createFakeTrading212();
		server.exportsOnDemo = true;
		expect(await client.reports.request({ from: "2026-01-01", to: "2026-02-01" })).toBeGreaterThan(0);
	});

	it("fails clearly when a report fails, never finishes, or has no ID", async () => {
		const failed = scripted([{ body: [{ reportId: 1, status: "Failed" }] }]);
		await expect(failed.client.reports.waitFor(1)).rejects.toThrow("Report 1 failed.");
		const cancelled = scripted([{ body: [{ reportId: 1, status: "Canceled" }] }]);
		await expect(cancelled.client.reports.waitFor(1)).rejects.toThrow("was cancelled");
		const running = { body: [{ reportId: 1, status: "Running" }] };
		const slow = scripted([{ body: [] }, running, running, running, running, running]);
		await expect(slow.client.reports.waitFor(1, { timeoutMs: 15, intervalMs: 10 })).rejects.toBeInstanceOf(
			TimeoutError,
		);
		const noId = scripted([{ body: {} }]);
		await expect(noId.client.reports.request({ from: "2026-01-01", to: "2026-02-01" })).rejects.toBeInstanceOf(
			UnexpectedResponseError,
		);
		const empty = scripted([{ body: null }]);
		expect(await empty.client.reports.list()).toEqual([]);
	});

	it("checks the download link and reports download failures", async () => {
		const { client } = scripted([]);
		await expect(client.reports.download({})).rejects.toThrow("no download link");
		await expect(client.reports.download("not a url")).rejects.toThrow("not a valid URL");
		await expect(client.reports.download("http://plain.example/x.csv")).rejects.toThrow("not https");
		const gone = scripted([{ status: 403 }]);
		await expect(gone.client.reports.download("https://s3.example/x.csv?sig=secret")).rejects.toThrow(
			"https://s3.example/x.csv?[REDACTED] failed with 403",
		);
		const offline = scripted([new TypeError("fetch failed")]);
		await expect(offline.client.reports.download("https://s3.example/x.csv")).rejects.toThrow("Could not download");
		const controller = new AbortController();
		controller.abort(new Error("stopped"));
		const aborted = scripted([new TypeError("aborted")]);
		await expect(
			aborted.client.reports.download("https://s3.example/x.csv", { signal: controller.signal }),
		).rejects.toThrow("stopped");
		const fine = scripted([{ body: "a,b\n1,2\n" }]);
		await expect(fine.client.reports.download("https://s3.example/x.csv", { timeoutMs: 1000 })).resolves.toBe(
			"a,b\n1,2\n",
		);
	});
});

describe("reports.export timeouts and download failures", () => {
	/** The export's timeout bounds the whole wait; it must not become the timeout of each request. */
	it("does not use the total wait as the request's timeout", async () => {
		const server = new FakeTrading212Server({}, "live");
		const slowRequests: typeof server.fetch = async (input, init) => {
			if (init.method === "POST") await new Promise((resolve) => setTimeout(resolve, 60));
			return server.fetch(input, init);
		};
		const client = new Trading212({
			environment: "live",
			apiKey: FAKE_API_KEY,
			apiSecret: FAKE_API_SECRET,
			fetch: slowRequests,
			rateLimit: "off",
		});
		const { csv } = await client.reports.export(
			{ from: "2026-01-01", to: "2026-02-01" },
			{ timeoutMs: 30, intervalMs: 1 },
		);
		expect(csv).toContain("Action,Time");
	});

	it("wraps a body that breaks during download, and never attaches the signed link", async () => {
		const broken = new Response(
			new ReadableStream({
				pull: (controller) => {
					controller.error(new Error("https://s3.example/x.csv?signature=secret-signature"));
				},
			}),
			{ status: 200 },
		);
		const { client } = scripted([], { fetch: () => Promise.resolve(broken) });
		const error = (await client.reports
			.download("https://s3.example/x.csv?signature=secret-signature")
			.catch((caught: unknown) => caught)) as Error;
		expect(error).toBeInstanceOf(NetworkError);
		expect(JSON.stringify(error)).not.toContain("secret-signature");
		expect(error.message).not.toContain("secret-signature");
	});
});
