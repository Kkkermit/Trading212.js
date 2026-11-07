import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/errors/errors";
import { validateOrder } from "../../src/orders/validate";

describe("validateOrder", () => {
	const issuesOf = (run: () => void): string[] => {
		try {
			run();
		} catch (error) {
			expect(error).toBeInstanceOf(ValidationError);
			return (error as ValidationError).issues.map((issue) => `${issue.field} ${issue.message}`);
		}
		return [];
	};

	it("accepts a correct order of every type", () => {
		expect(
			issuesOf(() => {
				validateOrder("market", { ticker: "A_US_EQ", quantity: -1.5, extendedHours: true });
			}),
		).toEqual([]);
		expect(
			issuesOf(() => {
				validateOrder("limit", { ticker: "A", quantity: 1, limitPrice: 10, timeValidity: "DAY" });
			}),
		).toEqual([]);
		expect(
			issuesOf(() => {
				validateOrder("stop", { ticker: "A", quantity: 1, stopPrice: 10, timeValidity: "GOOD_TILL_CANCEL" });
			}),
		).toEqual([]);
		expect(
			issuesOf(() => {
				validateOrder("stopLimit", { ticker: "A", quantity: 1, stopPrice: 10, limitPrice: 9, timeValidity: "DAY" });
			}),
		).toEqual([]);
	});

	it("names every problem at once", () => {
		expect(
			issuesOf(() => {
				validateOrder("limit", { ticker: " ", quantity: 0.123456, extendedHours: true });
			}),
		).toEqual([
			"ticker is required",
			"quantity has more than 4 decimal places; use truncateQuantity()",
			"limitPrice is required for a limit order",
			"timeValidity is required for a limit order",
			"extendedHours is only allowed on market orders",
		]);
	});

	it("checks every field's type", () => {
		expect(
			issuesOf(() => {
				validateOrder("stopLimit", {
					ticker: "AAPL US",
					quantity: Number.NaN,
					stopPrice: -1,
					limitPrice: "5",
					timeValidity: "WEEK",
					extendedHours: "yes",
				});
			}),
		).toEqual([
			"ticker must not contain spaces; use the Trading 212 ticker, such as AAPL_US_EQ",
			"quantity must be a finite number",
			"limitPrice must be a positive number",
			"stopPrice must be a positive number",
			'timeValidity must be "DAY" or "GOOD_TILL_CANCEL"',
			"extendedHours must be true or false",
			"extendedHours is only allowed on market orders",
		]);
		expect(
			issuesOf(() => {
				validateOrder("market", { ticker: "A", quantity: 0 });
			}),
		).toEqual(["quantity must not be zero"]);
		expect(
			issuesOf(() => {
				validateOrder("market", { ticker: "A", quantity: -1 }, "positive");
			}),
		).toEqual(["quantity must be positive; buy() and sell() set the sign themselves"]);
		expect(
			issuesOf(() => {
				validateOrder("market", { ticker: "A", quantity: 1, limitPrice: 3 });
			}),
		).toEqual(["limitPrice is not used by a market order"]);
	});
});
