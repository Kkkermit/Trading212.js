export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

/**
 * Anything with these four methods. `console` fits as it is; for pino or bunyan, whose methods take the fields
 * first, wrap them with {@link fieldsFirst}.
 */
export interface Logger {
	debug(message: string, fields?: LogFields): void;
	info(message: string, fields?: LogFields): void;
	warn(message: string, fields?: LogFields): void;
	error(message: string, fields?: LogFields): void;
}

const LEVELS: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

const noop = (): void => undefined;

/** The default: says nothing. */
export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };

/** The console methods `consoleLogger` writes to. */
export interface ConsoleLike {
	debug(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

/** Writes fields as `key=value`, quoting a value that has spaces or is not a string. */
function formatFields(fields: LogFields): string {
	return Object.entries(fields)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => {
			const bare = typeof value === "string" && /^[^\s"=]+$/.test(value);
			return `${key}=${bare ? value : JSON.stringify(value)}`;
		})
		.join(" ");
}

/**
 * Writes one line per event, such as `[trading212] WARN  Retrying GET … in 500 ms. endpoint=getAccountSummary`, and
 * drops anything below `level` (default `info`).
 */
export function consoleLogger(options: { level?: LogLevel; console?: ConsoleLike } = {}): Logger {
	const threshold = LEVELS[options.level ?? "info"];
	const target: ConsoleLike = options.console ?? console;
	const write =
		(level: LogLevel) =>
		(message: string, fields?: LogFields): void => {
			if (LEVELS[level] < threshold) return;
			const extra = fields ? formatFields(fields) : "";
			target[level](`[trading212] ${level.toUpperCase().padEnd(5)} ${message}${extra ? ` ${extra}` : ""}`);
		};
	return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

/** A pino- or bunyan-style log method. */
export type FieldsFirstMethod = (fields: LogFields, message: string) => void;

/** Adapts a pino- or bunyan-style logger, whose methods take `(fields, message)`. */
export function fieldsFirst(target: {
	debug: FieldsFirstMethod;
	info: FieldsFirstMethod;
	warn: FieldsFirstMethod;
	error: FieldsFirstMethod;
}): Logger {
	return {
		debug: (message, fields = {}) => {
			target.debug(fields, message);
		},
		info: (message, fields = {}) => {
			target.info(fields, message);
		},
		warn: (message, fields = {}) => {
			target.warn(fields, message);
		},
		error: (message, fields = {}) => {
			target.error(fields, message);
		},
	};
}

/** Wraps a user's logger so a throwing logger can never break a request, and every field is redacted. */
export function safeLogger(logger: Logger, redact: (value: unknown) => unknown): Logger {
	const call =
		(level: LogLevel) =>
		(message: string, fields?: LogFields): void => {
			try {
				logger[level](redact(message) as string, fields ? (redact(fields) as LogFields) : undefined);
			} catch {
				// A broken logger must not fail the request it was describing.
			}
		};
	return { debug: call("debug"), info: call("info"), warn: call("warn"), error: call("error") };
}
