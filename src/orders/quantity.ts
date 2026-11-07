/** The most decimal places Trading 212 accepts in an order quantity. Positions can hold more. */
export const QUANTITY_DECIMALS = 4;

/** Writes a finite number out in full, without exponent notation, using its shortest exact representation. */
function plain(value: number): string {
	const text = Math.abs(value).toString();
	const sign = value < 0 ? "-" : "";
	const match = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
	if (!match) return sign + text;
	const [, whole = "", fraction = "", exponentText = "0"] = match;
	const exponent = Number(exponentText);
	const digits = whole + fraction;
	const point = whole.length + exponent;
	if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
	if (point >= digits.length) return sign + digits + "0".repeat(point - digits.length);
	return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** How many decimal places a number has, as written. */
export function decimalPlaces(value: number): number {
	if (!Number.isFinite(value)) return Number.NaN;
	const fraction = plain(value).split(".")[1];
	return fraction ? fraction.replace(/0+$/, "").length : 0;
}

/**
 * Cuts a quantity to `decimals` places, always towards zero, so selling a whole 12.09032128-share position sends
 * 12.0903 and never more than you hold. Works on the number's exact text, not floating-point arithmetic.
 */
export function truncateQuantity(value: number, decimals = QUANTITY_DECIMALS): number {
	if (!Number.isFinite(value)) throw new RangeError("Cannot truncate a quantity that is not a finite number.");
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 20) throw new RangeError("decimals must be 0 to 20.");
	const [whole = "0", fraction = ""] = plain(value).split(".");
	const kept = fraction.slice(0, decimals);
	const result = Number(kept ? `${whole}.${kept}` : whole);
	return Object.is(result, -0) ? 0 : result;
}

/** True when Trading 212 will accept the number as an order quantity: finite, not zero, at most 4 decimal places. */
export function isValidQuantity(value: number): boolean {
	return Number.isFinite(value) && value !== 0 && decimalPlaces(value) <= QUANTITY_DECIMALS;
}
