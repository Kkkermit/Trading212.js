import { Trading212 } from "../client";
import type { EnvSource } from "../config";
import type { AccountSummary, Order, Position } from "../types/api.generated";

import { credentialRedactor, explain, optionsForCli } from "./shared";

export const SHOW_COMMANDS = ["summary", "positions", "orders"] as const;

export type ShowCommand = (typeof SHOW_COMMANDS)[number];

interface ShowOptions {
	readonly command: ShowCommand;
	readonly env: EnvSource;
	readonly json?: boolean;
	readonly write: (line: string) => void;
	readonly writeError: (line: string) => void;
	/** Builds the client; tests pass one wired to the fake server. */
	readonly createClient?: (env: EnvSource) => Trading212;
}

const money = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shares = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 8 });

const amount = (value: number | null | undefined): string => (typeof value === "number" ? money.format(value) : "-");
const count = (value: number | null | undefined): string => (typeof value === "number" ? shares.format(value) : "-");

/** Lays rows out in columns; the columns in `right` are right-aligned, as numbers read best. */
function table(rows: readonly (readonly string[])[], right: ReadonlySet<number>): string[] {
	const widths: number[] = [];
	for (const row of rows) {
		row.forEach((cell, column) => {
			widths[column] = Math.max(widths[column] ?? 0, cell.length);
		});
	}
	return rows.map((row) =>
		row
			.map((cell, column) =>
				right.has(column) ? cell.padStart(widths[column] ?? 0) : cell.padEnd(widths[column] ?? 0),
			)
			.join("  ")
			.trimEnd(),
	);
}

function summaryLines(summary: AccountSummary, environment: string): string[] {
	const { cash, investments } = summary;
	return [
		`Account ${String(summary.id ?? "?")} on ${environment}${summary.currency ? `, in ${summary.currency}` : ""}`,
		"",
		...table(
			[
				["Total value", amount(summary.totalValue)],
				["Cash to trade", amount(cash?.availableToTrade)],
				["Reserved for orders", amount(cash?.reservedForOrders)],
				["Cash in pies", amount(cash?.inPies)],
				["Invested", amount(investments?.currentValue)],
				["Unrealised profit", amount(investments?.unrealizedProfitLoss)],
				["Realised profit", amount(investments?.realizedProfitLoss)],
			],
			new Set([1]),
		),
	];
}

function positionLines(positions: readonly Position[]): string[] {
	if (positions.length === 0) return ["No open positions."];
	return table(
		[
			["Ticker", "Quantity", "Average price", "Price", "Value", "Profit"],
			...positions.map((position) => [
				position.instrument?.ticker ?? "?",
				count(position.quantity),
				amount(position.averagePricePaid),
				amount(position.currentPrice),
				amount(position.walletImpact?.currentValue),
				amount(position.walletImpact?.unrealizedProfitLoss),
			]),
		],
		new Set([1, 2, 3, 4, 5]),
	);
}

function orderLines(orders: readonly Order[]): string[] {
	if (orders.length === 0) return ["No pending orders."];
	return table(
		[
			["ID", "Ticker", "Side", "Type", "Quantity", "Filled", "Limit", "Stop", "Status", "Created"],
			...orders.map((order) => [
				String(order.id ?? "?"),
				order.ticker ?? order.instrument?.ticker ?? "?",
				order.side ?? "?",
				order.type ?? "?",
				count(order.quantity),
				count(order.filledQuantity),
				amount(order.limitPrice),
				amount(order.stopPrice),
				order.status ?? "?",
				order.createdAt ?? "-",
			]),
		],
		new Set([0, 4, 5, 6, 7]),
	);
}

const asJson = (data: unknown): string[] => [JSON.stringify(data, null, 2)];

async function linesFor(command: ShowCommand, client: Trading212, json: boolean): Promise<string[]> {
	switch (command) {
		case "summary": {
			const summary = await client.account.summary();
			return json ? asJson(summary) : summaryLines(summary, client.environment);
		}
		case "positions": {
			const positions = await client.positions.list();
			return json ? asJson(positions) : positionLines(positions);
		}
		case "orders": {
			const orders = await client.orders.list();
			return json ? asJson(orders) : orderLines(orders);
		}
	}
}

/** A client from the environment that cannot place or cancel an order, even on demo. */
export function readOnlyClient(env: EnvSource): Trading212 {
	return new Trading212({ ...optionsForCli(env), trading: "disabled" });
}

/** Prints the account summary, positions or pending orders, reading only. Returns the exit code. */
export async function runShow(options: ShowOptions): Promise<number> {
	const redact = credentialRedactor(options.env);
	try {
		const client = (options.createClient ?? readOnlyClient)(options.env);
		for (const line of await linesFor(options.command, client, options.json ?? false)) options.write(line);
		return 0;
	} catch (error) {
		options.writeError(redact(explain(error)) as string);
		return 1;
	}
}
