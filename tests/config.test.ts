import { afterEach, describe, expect, it } from "vitest";

import { Trading212 } from "../src/client";
import { basicAuthorization, optionsFromEnv, resolveOptions, type Trading212Options } from "../src/config";
import { ConfigurationError } from "../src/errors/errors";

import { API_KEY, API_SECRET } from "./helpers";

const base: Trading212Options = { environment: "demo", apiKey: API_KEY, apiSecret: API_SECRET };

function fieldOf(options: unknown): string | undefined {
	try {
		resolveOptions(options as Trading212Options);
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigurationError);
		return (error as ConfigurationError).field;
	}
	return undefined;
}

describe("resolveOptions", () => {
	it("fills in safe defaults", () => {
		const resolved = resolveOptions(base);
		expect(resolved).toMatchObject({
			environment: "demo",
			trading: "enabled",
			timeoutMs: 15_000,
			rateLimit: "pace",
			maxRateLimitWaitMs: 60_000,
			metadataTtlMs: 3_600_000,
			origin: "https://demo.trading212.com",
			officialOrigin: true,
		});
		expect(resolved.retry).toEqual({ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10_000 });
	});

	/** Live must never trade by accident: it reads until told otherwise. */
	it("leaves trading off on live unless enabled", () => {
		expect(resolveOptions({ ...base, environment: "live" }).trading).toBe("disabled");
		expect(resolveOptions({ ...base, environment: "live", trading: "enabled" }).trading).toBe("enabled");
		expect(resolveOptions({ ...base, trading: "disabled" }).trading).toBe("disabled");
	});

	it("insists on an environment, with no default", () => {
		expect(fieldOf({ ...base, environment: undefined })).toBe("environment");
		expect(fieldOf({ ...base, environment: "paper" })).toBe("environment");
		expect(fieldOf(null)).toBe("options");
	});

	it("catches the common credential slips, naming the field and never its value", () => {
		expect(fieldOf({ ...base, apiKey: "" })).toBe("apiKey");
		expect(fieldOf({ ...base, apiKey: 42 })).toBe("apiKey");
		expect(fieldOf({ ...base, apiKey: ` ${API_KEY}` })).toBe("apiKey");
		expect(fieldOf({ ...base, apiSecret: "has space" })).toBe("apiSecret");
		expect(fieldOf({ ...base, apiSecret: API_KEY })).toBe("apiSecret");
		expect(fieldOf({ ...base, apiKey: "a:b" })).toBe("apiKey");
		try {
			resolveOptions({ ...base, apiSecret: ` ${API_SECRET}` });
		} catch (error) {
			expect((error as Error).message).not.toContain(API_SECRET);
			expect((error as ConfigurationError).hint).toContain("copy-paste");
		}
	});

	it("validates every tunable", () => {
		expect(fieldOf({ ...base, trading: "yes" })).toBe("trading");
		expect(fieldOf({ ...base, rateLimit: "fast" })).toBe("rateLimit");
		expect(fieldOf({ ...base, timeoutMs: 0 })).toBe("timeoutMs");
		expect(fieldOf({ ...base, timeoutMs: Number.NaN })).toBe("timeoutMs");
		expect(fieldOf({ ...base, retry: { maxAttempts: 0 } })).toBe("retry.maxAttempts");
		expect(fieldOf({ ...base, retry: { maxAttempts: 1.5 } })).toBe("retry.maxAttempts");
		expect(fieldOf({ ...base, retry: { baseDelayMs: -1 } })).toBe("retry.baseDelayMs");
		expect(resolveOptions({ ...base, retry: false }).retry).toBeNull();
		expect(resolveOptions({ ...base, retry: { maxAttempts: 5 } }).retry).toEqual({
			maxAttempts: 5,
			baseDelayMs: 500,
			maxDelayMs: 10_000,
		});
	});

	it("only allows a base URL that keeps the key safe", () => {
		expect(resolveOptions({ ...base, baseUrl: "https://proxy.example" })).toMatchObject({
			origin: "https://proxy.example",
			officialOrigin: false,
		});
		expect(resolveOptions({ ...base, baseUrl: "http://localhost:8080" }).origin).toBe("http://localhost:8080");
		expect(resolveOptions({ ...base, baseUrl: "https://demo.trading212.com/" }).officialOrigin).toBe(true);
		expect(fieldOf({ ...base, baseUrl: "http://proxy.example" })).toBe("baseUrl");
		expect(fieldOf({ ...base, baseUrl: "not a url" })).toBe("baseUrl");
		expect(fieldOf({ ...base, baseUrl: "https://user:pass@proxy.example" })).toBe("baseUrl");
		expect(fieldOf({ ...base, baseUrl: "https://proxy.example/api" })).toBe("baseUrl");
		expect(fieldOf({ ...base, baseUrl: "https://proxy.example?x=1" })).toBe("baseUrl");
	});
});

describe("browser refusal", () => {
	const scope = globalThis as Record<string, unknown>;
	afterEach(() => {
		delete scope.document;
		delete scope.window;
	});

	it("refuses to start in a browser unless told it is understood", () => {
		scope.document = {};
		scope.window = {};
		expect(fieldOf(base)).toBe("dangerouslyAllowBrowser");
		expect(resolveOptions({ ...base, dangerouslyAllowBrowser: true }).environment).toBe("demo");
	});
});

describe("optionsFromEnv", () => {
	it("reads Trading 212's own variable names", () => {
		expect(optionsFromEnv({ T212_ENV: " Live ", T212_API_KEY: "k", T212_API_SECRET: "s" })).toEqual({
			environment: "live",
			apiKey: "k",
			apiSecret: "s",
		});
	});

	it("falls back to a key kept per environment", () => {
		expect(
			optionsFromEnv({
				T212_ENV: "demo",
				T212_DEMO_API_KEY: "dk",
				T212_DEMO_API_SECRET: "ds",
				T212_LIVE_API_KEY: "lk",
				T212_LIVE_API_SECRET: "ls",
			}),
		).toEqual({ environment: "demo", apiKey: "dk", apiSecret: "ds" });
	});

	it("says exactly what is missing", () => {
		expect(() => optionsFromEnv({})).toThrow("T212_ENV is not set.");
		expect(() => optionsFromEnv({ T212_ENV: "paper" })).toThrow('"paper"');
		expect(() => optionsFromEnv({ T212_ENV: "demo" })).toThrow("T212_API_KEY");
		expect(() => optionsFromEnv({ T212_ENV: "demo", T212_API_KEY: "k" })).toThrow("T212_API_SECRET");
	});

	it("reads process.env when given nothing", () => {
		const saved = { ...process.env };
		process.env.T212_ENV = "demo";
		process.env.T212_API_KEY = "env-key";
		process.env.T212_API_SECRET = "env-secret";
		try {
			expect(optionsFromEnv().apiKey).toBe("env-key");
			expect(Trading212.fromEnv().environment).toBe("demo");
		} finally {
			process.env = saved;
		}
	});
});

describe("basicAuthorization", () => {
	it("encodes key:secret as Basic, UTF-8 safe", () => {
		expect(basicAuthorization("user", "pass")).toBe(`Basic ${btoa("user:pass")}`);
		expect(basicAuthorization("ключ", "секрет")).toBe(`Basic ${Buffer.from("ключ:секрет", "utf8").toString("base64")}`);
	});
});
