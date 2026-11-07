import { ValidationError, type ValidationIssue } from "../errors/errors";

import { decimalPlaces, QUANTITY_DECIMALS } from "./quantity";

export const TIME_VALIDITIES = ["DAY", "GOOD_TILL_CANCEL"] as const;

/** `DAY` expires at midnight in the exchange's time zone; `GOOD_TILL_CANCEL` stays until it fills or you cancel it. */
export type OrderTimeValidity = (typeof TIME_VALIDITIES)[number];

export type OrderType = "market" | "limit" | "stop" | "stopLimit";

interface Fields {
	ticker?: unknown;
	quantity?: unknown;
	limitPrice?: unknown;
	stopPrice?: unknown;
	timeValidity?: unknown;
	extendedHours?: unknown;
}

const REQUIRED: Record<OrderType, readonly (keyof Fields)[]> = {
	market: [],
	limit: ["limitPrice", "timeValidity"],
	stop: ["stopPrice", "timeValidity"],
	stopLimit: ["stopPrice", "limitPrice", "timeValidity"],
};

const ALLOWED: Record<OrderType, ReadonlySet<keyof Fields>> = {
	market: new Set(["ticker", "quantity", "extendedHours"]),
	limit: new Set(["ticker", "quantity", "limitPrice", "timeValidity"]),
	stop: new Set(["ticker", "quantity", "stopPrice", "timeValidity"]),
	stopLimit: new Set(["ticker", "quantity", "stopPrice", "limitPrice", "timeValidity"]),
};

function issuesFor(type: OrderType, fields: Fields, signed: "positive" | "any"): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (field: string, message: string): void => {
		issues.push({ field, message });
	};

	if (typeof fields.ticker !== "string" || fields.ticker.trim() === "") add("ticker", "is required");
	else if (/\s/.test(fields.ticker))
		add("ticker", "must not contain spaces; use the Trading 212 ticker, such as AAPL_US_EQ");

	const quantity = fields.quantity;
	if (typeof quantity !== "number" || !Number.isFinite(quantity)) add("quantity", "must be a finite number");
	else if (quantity === 0) add("quantity", "must not be zero");
	else if (signed === "positive" && quantity < 0)
		add("quantity", "must be positive; buy() and sell() set the sign themselves");
	else if (decimalPlaces(quantity) > QUANTITY_DECIMALS) {
		add("quantity", `has more than ${QUANTITY_DECIMALS} decimal places; use truncateQuantity()`);
	}

	for (const field of REQUIRED[type]) {
		if (fields[field] === undefined) add(field, `is required for a ${type} order`);
	}
	for (const field of ["limitPrice", "stopPrice"] as const) {
		const price = fields[field];
		if (price !== undefined && (typeof price !== "number" || !Number.isFinite(price) || price <= 0)) {
			add(field, "must be a positive number");
		}
	}
	if (fields.timeValidity !== undefined && !TIME_VALIDITIES.includes(fields.timeValidity as OrderTimeValidity)) {
		add("timeValidity", 'must be "DAY" or "GOOD_TILL_CANCEL"');
	}
	if (fields.extendedHours !== undefined && typeof fields.extendedHours !== "boolean") {
		add("extendedHours", "must be true or false");
	}
	for (const [field, value] of Object.entries(fields)) {
		if (value !== undefined && !ALLOWED[type].has(field as keyof Fields)) {
			add(field, field === "extendedHours" ? "is only allowed on market orders" : `is not used by a ${type} order`);
		}
	}
	return issues;
}

const ORDER_TYPES = new Set<string>(["market", "limit", "stop", "stopLimit"]);

/** Checks an order before it is sent, and throws one `ValidationError` naming every problem. */
export function validateOrder(type: OrderType, fields: Fields, signed: "positive" | "any" = "any"): void {
	if (!ORDER_TYPES.has(type)) {
		throw new ValidationError(`"${type}" is not an order type.`, {
			issues: [{ field: "type", message: 'must be "market", "limit", "stop" or "stopLimit"' }],
			hint: "Nothing was sent.",
		});
	}
	const issues = issuesFor(type, fields, signed);
	if (issues.length === 0) return;
	const summary = issues.map((issue) => `${issue.field} ${issue.message}`).join("; ");
	throw new ValidationError(`The ${type} order is invalid: ${summary}.`, {
		issues,
		hint: "Nothing was sent. Fix the fields listed in `error.issues`.",
	});
}
