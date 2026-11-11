import { type EnvSource, optionsFromEnv, type Trading212Options } from "../config";
import { isTrading212Error } from "../errors/errors";
import { type ConsoleLike, consoleLogger } from "../logging/logger";
import { createRedactor, type Redactor } from "../logging/redact";

// Log lines go to stderr, so output piped as JSON stays readable.
const STDERR: ConsoleLike = {
	debug: (...args) => {
		console.error(...args);
	},
	info: (...args) => {
		console.error(...args);
	},
	warn: (...args) => {
		console.error(...args);
	},
	error: (...args) => {
		console.error(...args);
	},
};

/** Client options from the environment, with `T212_LOG` writing to stderr. */
export function optionsForCli(env: EnvSource): Trading212Options {
	const { logger, ...settings } = optionsFromEnv(env);
	return { ...settings, ...(logger && { logger: consoleLogger({ level: logger, console: STDERR }) }) };
}

/** Redacts every credential the environment holds, in case an error ever carries one. */
export function credentialRedactor(env: EnvSource): Redactor {
	return createRedactor(
		[
			env.T212_API_KEY,
			env.T212_API_SECRET,
			...["DEMO", "LIVE"].flatMap((name) => [env[`T212_${name}_API_KEY`], env[`T212_${name}_API_SECRET`]]),
		].filter((value): value is string => typeof value === "string" && value !== ""),
	);
}

export function explain(error: unknown): string {
	if (isTrading212Error(error)) return error.hint ? `${error.message}\n    ${error.hint}` : error.message;
	return error instanceof Error ? error.message : String(error);
}
