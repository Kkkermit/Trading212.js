import { afterEach, describe, expect, it, vi } from "vitest";

import { InstrumentNotFoundError, TimeoutError } from "../../src/errors/errors";
import { sessionAt } from "../../src/resources/exchanges";
import { createFakeTrading212 } from "../../src/testing";

import { scripted } from "../helpers";

describe("exchanges", () => {
	const events = [
		{ type: "PRE_MARKET_OPEN", date: "2026-11-09T09:00:00Z" },
		{ type: "OPEN", date: "2026-11-09T14:30:00Z" },
		{ type: "CLOSE", date: "2026-11-09T21:00:00Z" },
		{ type: "AFTER_HOURS_CLOSE", date: "2026-11-10T01:00:00Z" },
		{ type: "AFTER_HOURS_OPEN", date: "2026-11-09T21:00:01Z" },
		{ type: "OPEN", date: "2026-11-10T14:30:00Z" },
		{ type: "WHATEVER", date: "2026-11-11T00:00:00Z" },
		{ type: "OPEN" },
		{ date: "2026-11-12T00:00:00Z" },
		{ type: "OPEN", date: "not a date" },
	];

	it("works out the session from the schedule", () => {
		expect(sessionAt(events, new Date("2026-11-09T08:00:00Z"))).toMatchObject({
			session: "unknown",
			next: { event: "PRE_MARKET_OPEN" },
		});
		expect(sessionAt(events, new Date("2026-11-09T10:00:00Z")).session).toBe("preMarket");
		expect(sessionAt(events, new Date("2026-11-09T15:00:00Z"))).toMatchObject({
			session: "regular",
			since: new Date("2026-11-09T14:30:00Z"),
			next: { event: "CLOSE", at: new Date("2026-11-09T21:00:00Z") },
			nextOpen: new Date("2026-11-10T14:30:00Z"),
		});
		expect(sessionAt(events, new Date("2026-11-09T22:00:00Z")).session).toBe("afterHours");
		expect(sessionAt(events, new Date("2026-11-10T02:00:00Z")).session).toBe("closed");
		expect(sessionAt(events, new Date("2026-11-11T02:00:00Z"))).toMatchObject({
			session: "unknown",
			nextOpen: undefined,
		});
	});

	it("tells you whether an instrument's market is open", async () => {
		const exchanges = [{ id: 1, name: "NASDAQ", workingSchedules: [{ id: 1, timeEvents: events }] }];
		const { client } = createFakeTrading212({ state: { exchanges } });
		expect(await client.exchanges.status("AAPL_US_EQ", new Date("2026-11-09T15:00:00Z"))).toMatchObject({
			ticker: "AAPL_US_EQ",
			exchange: "NASDAQ",
			open: true,
			extendedHours: false,
		});
		const [apple] = await client.instruments.search("AAPL");
		expect(await client.exchanges.status(apple ?? {}, new Date("2026-11-09T22:00:00Z"))).toMatchObject({
			open: false,
			extendedHours: true,
		});
		expect(await client.exchanges.status("VUSAl_EQ")).toMatchObject({ session: "unknown", exchange: undefined });
		await expect(client.exchanges.status("NOPE")).rejects.toBeInstanceOf(InstrumentNotFoundError);
		expect(await client.exchanges.status({ workingScheduleId: 1 })).toMatchObject({ ticker: "" });
	});

	it("caches the exchange list", async () => {
		const { client, server } = createFakeTrading212();
		await client.exchanges.list();
		await client.exchanges.list();
		expect(server.requests.filter((request) => request.path.endsWith("/exchanges"))).toHaveLength(1);
		const empty = scripted([{ body: null }]);
		expect(await empty.client.exchanges.list()).toEqual([]);
	});
});

describe("sessionAt with simultaneous events", () => {
	/** Schedules often close regular hours and open after-hours at the same instant. */
	it("applies the close before the open at the same time", () => {
		const events = [
			{ type: "AFTER_HOURS_OPEN", date: "2026-11-09T21:00:00Z" },
			{ type: "CLOSE", date: "2026-11-09T21:00:00Z" },
			{ type: "OPEN", date: "2026-11-09T14:30:00Z" },
		];
		expect(sessionAt(events, new Date("2026-11-09T21:00:00Z")).session).toBe("afterHours");
		expect(sessionAt([...events].reverse(), new Date("2026-11-09T21:30:00Z")).session).toBe("afterHours");
	});
});

describe("sessionAt during a break", () => {
	it("names the end of the break as the next open", () => {
		const events = [
			{ type: "OPEN", date: "2026-11-09T08:00:00Z" },
			{ type: "BREAK_START", date: "2026-11-09T11:30:00Z" },
			{ type: "BREAK_END", date: "2026-11-09T12:30:00Z" },
			{ type: "CLOSE", date: "2026-11-09T16:30:00Z" },
			{ type: "OPEN", date: "2026-11-10T08:00:00Z" },
		];
		expect(sessionAt(events, new Date("2026-11-09T12:00:00Z"))).toMatchObject({
			session: "closed",
			nextOpen: new Date("2026-11-09T12:30:00Z"),
		});
	});
});

describe("isOpen and waitUntilOpen", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const HOUR = 3_600_000;
	const at = (time: number): string => new Date(time).toISOString();
	/** Closed now, pre-market in half an hour, regular hours in two. */
	function closedMarket(now: number) {
		return createFakeTrading212({
			client: { metadataTtlMs: 24 * HOUR },
			state: {
				exchanges: [
					{
						id: 1,
						name: "NASDAQ",
						workingSchedules: [
							{
								id: 1,
								timeEvents: [
									{ type: "CLOSE", date: at(now - HOUR) },
									{ type: "PRE_MARKET_OPEN", date: at(now + HOUR / 2) },
									{ type: "OPEN", date: at(now + 2 * HOUR) },
									{ type: "CLOSE", date: at(now + 8 * HOUR) },
								],
							},
						],
					},
				],
			},
		});
	}

	it("says whether a market is open, counting extended hours only when asked", async () => {
		vi.useFakeTimers({ now: new Date("2026-11-09T12:00:00Z") });
		const { client } = closedMarket(Date.now());
		expect(await client.exchanges.isOpen("AAPL_US_EQ")).toBe(false);
		vi.setSystemTime(Date.now() + HOUR);
		expect(await client.exchanges.isOpen("AAPL_US_EQ")).toBe(false);
		expect(await client.exchanges.isOpen("AAPL_US_EQ", { extendedHours: true })).toBe(true);
		vi.setSystemTime(Date.now() + 2 * HOUR);
		expect(await client.exchanges.isOpen("AAPL_US_EQ")).toBe(true);
	});

	it("sleeps until the scheduled opening, then resolves with the market's status", async () => {
		vi.useFakeTimers({ now: new Date("2026-11-09T12:00:00Z") });
		const start = Date.now();
		const { client, server } = closedMarket(start);
		const checks = vi.spyOn(client.exchanges, "status");
		const regular = client.exchanges.waitUntilOpen("AAPL_US_EQ");
		const extended = client.exchanges.waitUntilOpen("AAPL_US_EQ", { extendedHours: true });
		await vi.advanceTimersByTimeAsync(HOUR / 2);
		expect(await extended).toMatchObject({ session: "preMarket", extendedHours: true });
		await vi.advanceTimersByTimeAsync(HOUR + HOUR / 2);
		expect(await regular).toMatchObject({ session: "regular", open: true, since: new Date(start + 2 * HOUR) });
		// It sleeps until each opening rather than polling: a few checks and one download of each list in two hours.
		expect(checks.mock.calls.length).toBeLessThanOrEqual(6);
		expect(server.requests.map((request) => request.path.split("/").pop())).toEqual(["instruments", "exchanges"]);
	});

	it("gives up at once when the market opens after the timeout, and stops when the signal aborts", async () => {
		vi.useFakeTimers({ now: new Date("2026-11-09T12:00:00Z") });
		const { client } = closedMarket(Date.now());
		await expect(client.exchanges.waitUntilOpen("AAPL_US_EQ", { timeoutMs: HOUR })).rejects.toThrow(
			/opens at .*, after the 3600000 ms timeout/,
		);
		const controller = new AbortController();
		const waiting = client.exchanges.waitUntilOpen("AAPL_US_EQ", { signal: controller.signal });
		await vi.advanceTimersByTimeAsync(1000);
		controller.abort(new Error("stopped"));
		await expect(waiting).rejects.toThrow("stopped");
	});

	it("keeps checking when the schedule does not say, until its timeout", async () => {
		vi.useFakeTimers({ now: new Date("2026-11-09T12:00:00Z") });
		const { client } = createFakeTrading212({ state: { exchanges: [] } });
		const waiting = client.exchanges.waitUntilOpen("AAPL_US_EQ", { timeoutMs: 3 * HOUR });
		const settled = expect(waiting).rejects.toBeInstanceOf(TimeoutError);
		await vi.advanceTimersByTimeAsync(3 * HOUR);
		await settled;
	});
});
