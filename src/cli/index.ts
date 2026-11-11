import { readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";

import { VERSION } from "../version";

import { runDoctor } from "./doctor";
import { runShow, SHOW_COMMANDS, type ShowCommand } from "./show";

const HELP = `Usage: trading212 <command> [options]

Commands:
  doctor            Check your API key, environment and permissions
  summary           Show the account's cash, value and profit
  positions         List open positions
  orders            List pending orders
  version           Print the version

Options:
  --env <name>      demo or live (overrides T212_ENV; demo when neither is set)
  --env-file <path> Load variables from a file first, such as .env
  --json            Print the result as JSON
  -h, --help        Show this help

Reads T212_ENV, T212_API_KEY and T212_API_SECRET (or T212_DEMO_* / T212_LIVE_*),
and T212_LOG for log lines on stderr. The command line only reads: it never
places or cancels an order. Credentials are never printed.`;

const isShowCommand = (command: string): command is ShowCommand =>
	(SHOW_COMMANDS as readonly string[]).includes(command);

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
	let parsed;
	try {
		parsed = parseArgs({
			args: [...argv],
			allowPositionals: true,
			options: {
				env: { type: "string" },
				"env-file": { type: "string" },
				json: { type: "boolean", default: false },
				help: { type: "boolean", short: "h", default: false },
			},
		});
	} catch (error) {
		console.error((error as Error).message);
		console.error(HELP);
		return 2;
	}
	const [command] = parsed.positionals;
	if (parsed.values.help || command === undefined) {
		console.log(HELP);
		return command === undefined && !parsed.values.help ? 2 : 0;
	}
	if (command === "version") {
		console.log(VERSION);
		return 0;
	}
	if (command !== "doctor" && !isShowCommand(command)) {
		console.error(`Unknown command "${command}".\n\n${HELP}`);
		return 2;
	}
	// Variables already set win over the file, and the file never changes process.env.
	let fromFile: Record<string, string | undefined> = {};
	const envFile = parsed.values["env-file"];
	if (envFile) {
		try {
			fromFile = parseEnv(readFileSync(envFile, "utf8"));
		} catch (error) {
			console.error(`Could not read ${envFile}: ${(error as Error).message}`);
			return 2;
		}
	}
	const source: Record<string, string | undefined> = { ...fromFile, ...env };
	if (parsed.values.env) source.T212_ENV = parsed.values.env;
	else if (source.T212_ENV === undefined || source.T212_ENV.trim() === "") source.T212_ENV = "demo";
	if (isShowCommand(command)) {
		return runShow({
			command,
			env: source,
			json: parsed.values.json,
			write: (line) => {
				console.log(line);
			},
			writeError: (line) => {
				console.error(line);
			},
		});
	}
	return runDoctor({
		env: source,
		json: parsed.values.json,
		color: process.stdout.isTTY && !env.NO_COLOR,
		write: (line) => {
			console.log(line);
		},
	});
}
