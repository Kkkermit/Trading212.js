import { Trading212 } from "@kkkermit/trading212.js";
import { csvNumber, parseCsv } from "@kkkermit/trading212.js/csv";

const t212 = Trading212.fromEnv();

// Requests the report, waits for it (at least a minute) and downloads it.
const { report, csv } = await t212.reports.export(
	{ from: "2026-01-01", to: "2026-12-31", include: { interest: false } },
	{ onStatus: (current) => console.log(`Report ${current.reportId}: ${current.status}`) },
);
console.log(`Report ${report.reportId} has ${csv.length} characters`);

let deposits = 0;
for (const row of parseCsv(csv)) {
	if (row.Action === "Deposit") deposits += csvNumber(row.Total) ?? 0;
}
console.log(`Deposited ${deposits.toFixed(2)} this year`);
