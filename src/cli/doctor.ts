import { styleText } from "node:util";

import { Trading212 } from "../client";
import { type EnvSource, optionsFromEnv } from "../config";
import { isTrading212Error, MissingScopeError, NotAvailableInDemoError } from "../errors/errors";
import { createRedactor } from "../logging/redact";
import { VERSION } from "../version";

export type CheckStatus = "ok" | "missing" | "warning" | "failed" | "skipped";

export interface CheckResult {
	readonly name: string;
	readonly status: CheckStatus;
	readonly detail: string;
}

export interface DoctorOptions {
	readonly env: EnvSource;
	readonly json?: boolean;
	readonly color?: boolean;
	readonly write: (line: string) => void;
	/** Builds the client; tests pass one wired to the fake server. */
	readonly createClient?: (env: EnvSource) => Trading212;
}

const SYMBOL: Record<CheckStatus, string> = { ok: "✓", missing: "✗", warning: "⚠", failed: "✗", skipped: "·" };
const COLOUR: Record<CheckStatus, "green" | "red" | "yellow" | "gray"> = {
	ok: "green",
	missing: "red",
	warning: "yellow",
	failed: "red",
	skipped: "gray",
};

function explain(error: unknown): string {
	if (isTrading212Error(error)) return error.hint ? `${error.message}\n    ${error.hint}` : error.message;
	return error instanceof Error ? error.message : String(error);
}

/** Checks the key, environment and every permission that can be checked without trading. Returns the exit code. */
export async function runDoctor(options: DoctorOptions): Promise<number> {
	const results: CheckResult[] = [];
	// Redacts its own output too, in case an error from the client ever carries a credential.
	const redact = createRedactor(
		[
			options.env.T212_API_KEY,
			options.env.T212_API_SECRET,
			...["DEMO", "LIVE"].flatMap((name) => [
				options.env[`T212_${name}_API_KEY`],
				options.env[`T212_${name}_API_SECRET`],
			]),
		].filter((value): value is string => typeof value === "string"),
	);
	const paint = (status: CheckStatus, text: string): string =>
		options.color ? styleText(COLOUR[status], text, { validateStream: false }) : text;
	const report = (result: CheckResult): void => {
		const safe = { ...result, detail: redact(result.detail) as string };
		results.push(safe);
		if (!options.json) options.write(`${paint(safe.status, SYMBOL[safe.status])} ${safe.name}: ${safe.detail}`);
	};
	const finish = (code: number): number => {
		if (options.json) options.write(JSON.stringify({ version: VERSION, ok: code === 0, checks: results }, null, 2));
		return code;
	};

	if (!options.json) options.write(`trading212.js ${VERSION} doctor\n`);

	let client: Trading212;
	try {
		const settings = optionsFromEnv(options.env);
		report({
			name: "settings",
			status: "ok",
			detail: `environment ${settings.environment}, key ${settings.apiKey.length} characters, secret ${settings.apiSecret.length} characters`,
		});
		client = options.createClient ? options.createClient(options.env) : new Trading212(settings);
	} catch (error) {
		report({ name: "settings", status: "failed", detail: explain(error) });
		return finish(1);
	}

	try {
		const me = await client.verify();
		report({
			name: "sign in",
			status: "ok",
			detail: `account ${me.accountId ?? "?"} (${me.currency ?? "?"}) on ${me.environment}`,
		});
	} catch (error) {
		report({ name: "sign in", status: "failed", detail: explain(error) });
		return finish(1);
	}

	const probes: [scope: string, run: () => Promise<unknown>][] = [
		["portfolio", () => client.positions.list()],
		["metadata", () => client.exchanges.list()],
		["orders:read", () => client.orders.list()],
		["history:orders", () => client.history.orders.list({ limit: 1 })],
		["history:dividends", () => client.history.dividends.list({ limit: 1 })],
		["history:transactions", () => client.history.transactions.list({ limit: 1 })],
		// eslint-disable-next-line @typescript-eslint/no-deprecated -- checking the permission is still useful
		["pies:read", () => client.pies.list()],
	];
	for (const [scope, run] of probes) {
		try {
			await run();
			report({ name: scope, status: "ok", detail: "allowed" });
		} catch (error) {
			if (error instanceof MissingScopeError) {
				report({ name: scope, status: "missing", detail: `not on this key (create one with "${scope}" ticked)` });
			} else report({ name: scope, status: "warning", detail: explain(error) });
		}
	}
	try {
		await client.reports.list();
		report({ name: "exports", status: "ok", detail: "allowed" });
	} catch (error) {
		if (error instanceof NotAvailableInDemoError) report({ name: "exports", status: "skipped", detail: "live only" });
		else if (error instanceof MissingScopeError)
			report({ name: "exports", status: "missing", detail: "not on this key" });
		else report({ name: "exports", status: "warning", detail: explain(error) });
	}
	report({ name: "orders:execute", status: "skipped", detail: "not checked: it would need a real order" });
	report({
		name: "trading",
		status: client.trading === "enabled" ? "ok" : "skipped",
		detail:
			client.trading === "enabled"
				? `orders can be placed on ${client.environment}`
				: 'off: a live client only reads until created with trading: "enabled"',
	});
	return finish(0);
}
