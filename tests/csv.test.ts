import { describe, expect, it } from "vitest";

import { csvNumber, parseCsv, parseCsvRows } from "../src/csv";

describe("parseCsvRows", () => {
	it("reads quotes, doubled quotes, embedded commas and newlines", () => {
		expect(parseCsvRows('a,"b,c","say ""hi""","two\nlines"\r\n1,2,3,4')).toEqual([
			["a", "b,c", 'say "hi"', "two\nlines"],
			["1", "2", "3", "4"],
		]);
	});

	it("drops a byte-order mark and copes with CR, empty fields and no final newline", () => {
		expect(parseCsvRows("﻿x,,y\rz")).toEqual([["x", "", "y"], ["z"]]);
		expect(parseCsvRows("")).toEqual([]);
		expect(parseCsvRows("a,\n")).toEqual([["a", ""]]);
		expect(parseCsvRows('a"b')).toEqual([['a"b']]);
	});
});

describe("parseCsv", () => {
	it("keys each row by the header and skips blank lines", () => {
		expect(parseCsv("Action,Ticker,Total\nMarket buy,AAPL_US_EQ,230\n\nDeposit,,1000\nshort\n")).toEqual([
			{ Action: "Market buy", Ticker: "AAPL_US_EQ", Total: "230" },
			{ Action: "Deposit", Ticker: "", Total: "1000" },
			{ Action: "short", Ticker: "", Total: "" },
		]);
		expect(parseCsv("")).toEqual([]);
	});
});

describe("csvNumber", () => {
	it("reads numbers with thousands separators, and nothing else", () => {
		expect(csvNumber("1,234.56")).toBe(1234.56);
		expect(csvNumber(" -0.5 ")).toBe(-0.5);
		expect(csvNumber("")).toBeUndefined();
		expect(csvNumber("GBP")).toBeUndefined();
		expect(csvNumber(undefined)).toBeUndefined();
		expect(csvNumber("12,345,678.9")).toBe(12_345_678.9);
		expect(csvNumber("1e3")).toBe(1000);
	});

	/** A comma that is not a thousands separator would silently multiply the value. */
	it("refuses a decimal comma and other things Number() would accept", () => {
		expect(csvNumber("1,5")).toBeUndefined();
		expect(csvNumber("1,23,456")).toBeUndefined();
		expect(csvNumber("0x10")).toBeUndefined();
		expect(csvNumber("Infinity")).toBeUndefined();
		expect(csvNumber("1e999")).toBeUndefined();
		expect(csvNumber("12 345")).toBeUndefined();
		expect(csvNumber("0,123")).toBeUndefined();
	});
});
