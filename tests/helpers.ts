import { Trading212 } from "../src/client";
import type { Trading212Options } from "../src/config";
import { type ScriptStep, scriptedFetch } from "../src/testing/scriptedFetch";

export const API_KEY = "test-api-key-0123456789";
export const API_SECRET = "test-api-secret-abcdefghij";

/** A client over a scripted fetch, with pacing off and near-instant retries. */
export function scripted(steps: readonly ScriptStep[], options: Partial<Trading212Options> = {}) {
	const script = scriptedFetch(steps);
	const client = new Trading212({
		environment: "demo",
		apiKey: API_KEY,
		apiSecret: API_SECRET,
		rateLimit: "off",
		retry: { baseDelayMs: 1, maxDelayMs: 2 },
		fetch: script.fetch,
		...options,
	});
	return { client, ...script };
}

/** A logger that remembers every call. */
export function memoryLogger() {
	const lines: { level: string; message: string; fields: Record<string, unknown> | undefined }[] = [];
	const at =
		(level: string) =>
		(message: string, fields?: Record<string, unknown>): void => {
			lines.push({ level, message, fields });
		};
	return { lines, logger: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") } };
}

/** A fetch that never answers, but rejects when its signal aborts, as fetch does. */
export function hangingFetch(): (input: string, init: RequestInit) => Promise<Response> {
	return (_input, init) =>
		new Promise((_resolve, reject) => {
			init.signal?.addEventListener("abort", () => {
				reject(init.signal?.reason as Error);
			});
		});
}
