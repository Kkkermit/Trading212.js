import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as csv from "../src/csv";
import * as main from "../src/index";
import * as testing from "../src/testing";

const root = join(import.meta.dirname, "..");
const pages = join(root, "docs/src/content/docs");

function mdxFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? mdxFiles(join(dir, entry.name)) : entry.name.endsWith(".mdx") ? [join(dir, entry.name)] : [],
	);
}

const docs = mdxFiles(pages)
	.map((file) => readFileSync(file, "utf8"))
	.join("\n");
const methodsPage = readFileSync(join(pages, "reference/methods.mdx"), "utf8");

/** Names in `export { … }` and `export type { … }` lists, so exported types are checked as well as values. */
function exportedNames(file: string): string[] {
	const source = readFileSync(join(root, file), "utf8");
	return [...source.matchAll(/export (?:type )?\{([^}]*)\}/g)].flatMap((match) =>
		(match[1] ?? "")
			.split(",")
			.map((name) => name.replace(/^\s*type\s+/, "").trim())
			.filter(Boolean),
	);
}

const documented = (name: string): boolean => docs.includes(`\`${name}`);

describe("documentation", () => {
	/** A new export users cannot read about is as good as missing. */
	it("mentions every export of every entry point", () => {
		const names = new Set([
			...Object.keys(main),
			...Object.keys(testing),
			...Object.keys(csv),
			...exportedNames("src/index.ts"),
			...exportedNames("src/testing/index.ts"),
		]);
		expect([...names].filter((name) => !documented(name)).sort()).toEqual([]);
	});

	it("gives every client method its own entry in the method reference", () => {
		const { client } = testing.createFakeTrading212();
		const methodsOf = (value: object): string[] =>
			Object.getOwnPropertyNames(Object.getPrototypeOf(value)).filter((name) => name !== "constructor");
		const resources = [
			"account",
			"positions",
			"portfolio",
			"instruments",
			"exchanges",
			"orders",
			"reports",
			"pies",
		] as const;
		const expected = [
			...resources.flatMap((resource) => methodsOf(client[resource]).map((method) => `${resource}.${method}`)),
			...methodsOf(client.history.orders).map((method) => `history.*.${method}`),
		];
		const missing = expected.filter((name) => !methodsPage.includes(`### \`${name}()\``));
		expect(missing).toEqual([]);
	});
});
