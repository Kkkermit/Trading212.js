import { describe, expect, it, vi } from "vitest";

import { credentialRedactor, explain, optionsForCli } from "../../src/cli/shared";
import { ValidationError } from "../../src/errors/errors";

const ENV = { T212_ENV: "demo", T212_API_KEY: "cli-key-1234567", T212_API_SECRET: "cli-secret-abcdef" };

describe("command-line helpers", () => {
	/** Log lines on stdout would break `--json` output piped into another program. */
	it("sends T212_LOG's log lines to stderr", () => {
		const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
		const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			const { logger } = optionsForCli({ ...ENV, T212_LOG: "debug" });
			if (typeof logger !== "object") throw new Error("expected a logger");
			logger.debug("hello");
			logger.info("there");
			expect(stderr.mock.calls.flat()).toEqual(["[trading212] DEBUG hello", "[trading212] INFO  there"]);
			expect(stdout).not.toHaveBeenCalled();
			expect(debug).not.toHaveBeenCalled();
			expect(optionsForCli(ENV)).not.toHaveProperty("logger");
		} finally {
			stdout.mockRestore();
			debug.mockRestore();
			stderr.mockRestore();
		}
	});

	it("redacts every credential the environment holds, and explains errors with their hint", () => {
		const redact = credentialRedactor({ ...ENV, T212_LIVE_API_SECRET: "live-secret-xyz", T212_DEMO_API_KEY: "" });
		expect(redact(`${ENV.T212_API_KEY} ${ENV.T212_API_SECRET} live-secret-xyz`)).not.toMatch(/cli-|live-secret/);
		expect(explain(new ValidationError("Wrong.", { hint: "Fix it." }))).toBe("Wrong.\n    Fix it.");
		expect(explain(new Error("plain"))).toBe("plain");
		expect(explain("text")).toBe("text");
	});
});
