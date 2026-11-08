import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
	scripts: Record<string, string>;
	files: string[];
	bin: Record<string, string>;
};

describe("the published package", () => {
	/** 0.1.0 went to npm from a checkout with no dist/, so it held no code at all. */
	it("builds before every pack and publish", () => {
		expect(pkg.scripts.prepack).toBe("npm run build");
	});

	/** npm rewrites "./dist/cli.js" when publishing, and warns that the command was removed when it was not. */
	it("names its command's file the way npm writes it, inside a folder it ships", () => {
		for (const path of Object.values(pkg.bin)) {
			expect(path).not.toMatch(/^\.\//);
			expect(pkg.files).toContain(path.split("/")[0]);
		}
	});
});
