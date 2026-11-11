import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { main } from "../src/cli/index";

describe("the command line", () => {
	const run = async (argv: string[], env: NodeJS.ProcessEnv = {}) => {
		const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const code = await main(argv, env);
		const result = { code, out: out.mock.calls.flat().join("\n"), err: err.mock.calls.flat().join("\n") };
		out.mockRestore();
		err.mockRestore();
		return result;
	};

	it("prints help and the version", async () => {
		expect((await run(["--help"])).out).toContain("Usage: trading212");
		expect((await run([])).code).toBe(2);
		expect((await run(["version"])).out).toBe("0.0.0-test");
	});

	it("lists the read-only commands, and uses demo when no environment is named", async () => {
		expect((await run(["--help"])).out).toMatch(/summary[\s\S]*positions[\s\S]*orders/);
		const result = await run(["positions"], { T212_ENV: "" });
		expect(result.code).toBe(1);
		expect(result.err).toContain("T212_DEMO_API_KEY");
		expect((await run(["orders", "--env", "live"])).err).toContain("T212_LIVE_API_KEY");
	});

	it("refuses unknown commands and options", async () => {
		expect(await run(["frobnicate"])).toMatchObject({
			code: 2,
			err: expect.stringContaining('Unknown command "frobnicate"'),
		});
		expect((await run(["doctor", "--nope"])).code).toBe(2);
	});

	it("runs the doctor, taking the environment from a flag or a file", async () => {
		const missing = await run(["doctor", "--env", "live"], {});
		expect(missing.code).toBe(1);
		expect(missing.out).toContain("T212_API_KEY");
		const directory = mkdtempSync(join(tmpdir(), "t212-"));
		const file = join(directory, ".env");
		writeFileSync(file, "T212_ENV=paper\n");
		const saved = { ...process.env };
		try {
			const fromFile = await run(["doctor", "--env-file", file, "--json"], {});
			expect(fromFile.out).toContain('\\"paper\\"');
		} finally {
			process.env = saved;
		}
		expect((await run(["doctor", "--env-file", join(directory, "missing")])).err).toContain("Could not read");

		// Variables already set win over the file, and the file never reaches process.env.
		writeFileSync(file, "T212_ENV=live\nT212_FROM_FILE_ONLY=1\n");
		const flagWins = await run(["doctor", "--env-file", file, "--json"], { T212_ENV: "demo" });
		expect(flagWins.out).toContain("T212_DEMO_API_KEY");
		expect(process.env.T212_FROM_FILE_ONLY).toBeUndefined();
	});
});
