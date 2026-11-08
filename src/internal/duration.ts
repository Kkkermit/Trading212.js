import { ValidationError } from "../errors/errors";

// Timers fire at once past this, so a longer wait would silently become none.
const MAX_TIMER_MS = 2_147_483_647;

/** A duration passed for one call, in whole milliseconds, or `undefined` when none was passed. */
export function durationOption(value: unknown, field: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_TIMER_MS) {
		throw new ValidationError(`${field} must be a positive number of milliseconds.`, {
			issues: [{ field, message: "must be a positive number of milliseconds" }],
			hint: "Nothing was sent.",
		});
	}
	return Math.ceil(value);
}
