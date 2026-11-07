import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENDPOINTS } from "../src/http/endpoints.generated";

const root = join(import.meta.dirname, "..");
const spec = JSON.parse(readFileSync(join(root, "openapi/trading212.json"), "utf8")) as {
	paths: Record<string, Record<string, unknown>>;
};
const METHODS = ["get", "post", "put", "patch", "delete"];

const resources = readdirSync(join(root, "src/resources"))
	.map((file) => readFileSync(join(root, "src/resources", file), "utf8"))
	.join("\n");
const fakeServer = readFileSync(join(root, "src/testing/fakeServer.ts"), "utf8");
const coverageTables = {
	"README.md": readFileSync(join(root, "README.md"), "utf8"),
	"docs API coverage": readFileSync(join(root, "docs/src/content/docs/reference/api-coverage.mdx"), "utf8"),
};

describe("API coverage", () => {
	/** A path or method added to the spec must be generated, named and implemented, not silently skipped. */
	it("has an endpoint for every operation in the official spec", () => {
		const fromSpec = Object.entries(spec.paths).flatMap(([path, operations]) =>
			METHODS.filter((method) => method in operations).map((method) => `${method.toUpperCase()} ${path}`),
		);
		const generated = Object.values(ENDPOINTS).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
		expect(generated.sort()).toEqual(fromSpec.sort());
	});

	it("calls every endpoint from a resource method", () => {
		const unused = Object.keys(ENDPOINTS).filter((id) => !resources.includes(`ENDPOINTS.${id}`));
		expect(unused).toEqual([]);
	});

	it("answers every endpoint from the fake server", () => {
		const unrouted = Object.keys(ENDPOINTS).filter((id) => !fakeServer.includes(`case "${id}":`));
		expect(unrouted).toEqual([]);
	});

	it("lists every endpoint in the README and docs coverage tables", () => {
		const missing = Object.entries(coverageTables).flatMap(([where, text]) =>
			Object.values(ENDPOINTS)
				.map((endpoint) => `\`${endpoint.method} ${endpoint.path.replace("/api/v0", "")}\``)
				.filter((row) => !text.includes(row))
				.map((row) => `${where}: ${row}`),
		);
		expect(missing).toEqual([]);
	});
});
