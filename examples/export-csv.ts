// Exports a year of history as CSV (live accounts only) and reads it back as rows.
import { Trading212 } from "@kkermit/trading212.js";
import { parseCsv } from "@kkermit/trading212.js/csv";

const t212 = Trading212.fromEnv();
const { csv } = await t212.reports.export(
	{ from: "2026-01-01", to: "2026-12-31" },
	{
		onStatus: (report) => {
			console.log(`report ${report.reportId ?? "?"}: ${report.status ?? "?"}`);
		},
	},
);
const rows = parseCsv(csv);
console.log(`${rows.length} rows; columns: ${Object.keys(rows[0] ?? {}).join(", ")}`);
