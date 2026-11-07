import { parseArgs } from "node:util";

import { VERSION } from "../version";

import { runDoctor } from "./doctor";

const HELP = `Usage: trading212 <command> [options]

Commands:
  doctor            Check your API key, environment and permissions
  version           Print the version

Options:
  --env <name>      demo or live (overrides T212_ENV)
  --env-file <path> Load variables from a file first, such as .env
  --json            Print the result as JSON
  -h, --help        Show this help

Reads T212_ENV, T212_API_KEY and T212_API_SECRET (or T212_DEMO_* / T212_LIVE_*).
Credentials are never printed.`;

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
	if (command !== "doctor") {
		console.error(`Unknown command "${command}".\n\n${HELP}`);
		return 2;
	}
	const source: Record<string, string | undefined> = { ...env };
	if (parsed.values["env-file"]) {
		try {
			process.loadEnvFile(parsed.values["env-file"]);
			Object.assign(source, process.env);
		} catch (error) {
			console.error(`Could not read ${parsed.values["env-file"]}: ${(error as Error).message}`);
			return 2;
		}
	}
	if (parsed.values.env) source.T212_ENV = parsed.values.env;
	return runDoctor({
		env: source,
		json: parsed.values.json,
		color: process.stdout.isTTY && !env.NO_COLOR,
		write: (line) => {
			console.log(line);
		},
	});
}
