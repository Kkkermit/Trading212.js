/**
 * A small RFC 4180 CSV parser for Trading 212's report exports: quoted fields, doubled quotes, commas and newlines
 * inside quotes, CRLF or LF line ends, and a leading byte-order mark. Values stay strings.
 */
export function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	for (; index < text.length; index++) {
		const char = text.charAt(index);
		if (quoted) {
			if (char === '"') {
				if (text[index + 1] === '"') {
					field += '"';
					index++;
				} else quoted = false;
			} else field += char;
		} else if (char === '"' && field === "") quoted = true;
		else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && text[index + 1] === "\n") index++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += char;
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/**
 * Parses CSV with a header row into one object per line, keyed by column name.
 *
 * @example
 * import { parseCsv } from "@kkermit/trading212.js/csv";
 * const { csv } = await t212.reports.export({ from: "2026-01-01", to: "2026-06-30" });
 * for (const row of parseCsv(csv)) console.log(row.Action, row.Ticker, row["Total"]);
 */
export function parseCsv(text: string): Record<string, string>[] {
	const [header, ...rows] = parseCsvRows(text);
	if (!header) return [];
	return rows
		.filter((row) => !(row.length === 1 && row[0] === ""))
		.map((row) => Object.fromEntries(header.map((name, column) => [name, row[column] ?? ""])));
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/**
 * Reads a number from a CSV cell, such as `1234.56`, `1,234.56` or `-0.5`, or returns `undefined` for anything else.
 * Trading 212 writes decimals with a full stop, so a comma is accepted only between groups of three digits.
 */
export function csvNumber(value: string | undefined): number | undefined {
	const trimmed = value?.trim() ?? "";
	const plain = GROUPED.test(trimmed) ? trimmed.replaceAll(",", "") : trimmed;
	if (!DECIMAL.test(plain)) return undefined;
	const number = Number(plain);
	return Number.isFinite(number) ? number : undefined;
}
