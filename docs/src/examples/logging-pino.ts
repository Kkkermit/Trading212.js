import { fieldsFirst, Trading212 } from "@kkkermit/trading212.js";
import pino from "pino";

// pino and bunyan take (fields, message); fieldsFirst swaps the arguments.
const t212 = Trading212.fromEnv({ logger: fieldsFirst(pino({ level: "debug" })) });

await t212.account.summary();
