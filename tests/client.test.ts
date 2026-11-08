import { describe, expect, it } from "vitest";

import { Trading212 } from "../src/client";
import { type Trading212Options } from "../src/config";
import { ConfigurationError } from "../src/errors/errors";

import { API_KEY, API_SECRET, memoryLogger } from "./helpers";

const base: Trading212Options = { environment: "demo", apiKey: API_KEY, apiSecret: API_SECRET };

describe("Trading212 construction", () => {
	it("warns when requests go somewhere other than Trading 212", () => {
		const { lines, logger } = memoryLogger();
		new Trading212({ ...base, baseUrl: "https://proxy.example", logger });
		expect(lines).toEqual([
			expect.objectContaining({ level: "warn", message: expect.stringContaining("not Trading 212's demo host") }),
		]);
	});

	it("needs a fetch", () => {
		const saved = globalThis.fetch;
		// @ts-expect-error -- simulating a runtime without fetch
		delete globalThis.fetch;
		try {
			expect(() => new Trading212(base)).toThrow(ConfigurationError);
		} finally {
			globalThis.fetch = saved;
		}
	});

	it("builds from the environment with overrides", () => {
		const client = Trading212.fromEnv(
			{ trading: "enabled" },
			{ T212_ENV: "live", T212_API_KEY: "live-key-123", T212_API_SECRET: "live-secret-456" },
		);
		expect(client.environment).toBe("live");
		expect(client.trading).toBe("enabled");
	});
});
