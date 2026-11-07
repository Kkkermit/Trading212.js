import { type LogFields, type Logger, Trading212 } from "@kkkermit/trading212.js";

// Any object with these four methods is a logger. Fields arrive with credentials removed.
const logger: Logger = {
	debug: () => {},
	info: (message: string, fields?: LogFields) => console.log(new Date().toISOString(), message, fields),
	warn: (message: string, fields?: LogFields) => console.warn(new Date().toISOString(), message, fields),
	error: (message: string, fields?: LogFields) => console.error(new Date().toISOString(), message, fields),
};

const t212 = Trading212.fromEnv({ logger });
await t212.verify();
