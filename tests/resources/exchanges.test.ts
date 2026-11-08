import { describe, expect, it } from "vitest";

import { InstrumentNotFoundError } from "../../src/errors/errors";
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
