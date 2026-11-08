import { describe, expect, it } from "vitest";

import { decimalPlaces, isValidQuantity, truncateQuantity } from "../../src/orders/quantity";

describe("quantities", () => {
	it("counts decimal places, including numbers JavaScript writes with an exponent", () => {
		expect(decimalPlaces(12.09032128)).toBe(8);
		expect(decimalPlaces(5)).toBe(0);
		expect(decimalPlaces(1e-7)).toBe(7);
		expect(decimalPlaces(1.5e-7)).toBe(8);
		expect(decimalPlaces(1e21)).toBe(0);
		expect(decimalPlaces(Number.NaN)).toBeNaN();
	});

	/** Rounding up would try to sell shares you do not have, which Trading 212 refuses. */
	it("truncates towards zero and never rounds up", () => {
		expect(truncateQuantity(12.09032128)).toBe(12.0903);
		expect(truncateQuantity(0.99999999)).toBe(0.9999);
		expect(truncateQuantity(-1.23456)).toBe(-1.2345);
		expect(truncateQuantity(1e-7)).toBe(0);
		expect(truncateQuantity(-1e-7)).toBe(0);
		expect(Object.is(truncateQuantity(-0.00001), 0)).toBe(true);
		expect(truncateQuantity(2.5, 0)).toBe(2);
		expect(truncateQuantity(1.23e21)).toBe(1.23e21);
		expect(truncateQuantity(123.4567, 2)).toBe(123.45);
	});

	it("refuses nonsense", () => {
		expect(() => truncateQuantity(Number.POSITIVE_INFINITY)).toThrow(RangeError);
		expect(() => truncateQuantity(1, -1)).toThrow(RangeError);
		expect(() => truncateQuantity(1, 0.5)).toThrow(RangeError);
	});

	it("says whether Trading 212 will accept a quantity", () => {
		expect(isValidQuantity(0.1234)).toBe(true);
		expect(isValidQuantity(-3)).toBe(true);
		expect(isValidQuantity(0.12345)).toBe(false);
		expect(isValidQuantity(0)).toBe(false);
		expect(isValidQuantity(Number.NaN)).toBe(false);
	});
});
