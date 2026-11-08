import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext, Script } from "node:vm";

import { describe, expect, it } from "vitest";

import { toCommonJs } from "../docs/src/lib/commonjs";
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

const examplesDir = join(root, "docs/src/examples");
const examples = readdirSync(examplesDir).filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));

describe("the JavaScript beside each example", () => {
	/** Every JavaScript tab is CommonJS: require(), and no top-level await, which a CommonJS file cannot parse. */
	it("is CommonJS that Node can parse, for every example", async () => {
		const failures: string[] = [];
		for (const file of examples) {
			const javascript = await toCommonJs(readFileSync(join(examplesDir, file), "utf8"));
			try {
				new Script(javascript, { filename: file.replace(/\.ts$/, ".cjs") });
			} catch (error) {
				failures.push(`${file}: ${(error as Error).message}`);
			}
			if (/^\s*(import|export)\s/m.test(javascript)) failures.push(`${file}: still has import or export`);
		}
		expect(failures).toEqual([]);
	});

	it("runs, with require() giving it the library", async () => {
		const javascript = await toCommonJs(readFileSync(join(examplesDir, "try-offline.ts"), "utf8"));
		const modules: Record<string, unknown> = {
			"@kkkermit/trading212.js": main,
			"@kkkermit/trading212.js/testing": testing,
		};
		const lines: string[] = [];
		const finished = runInNewContext(javascript, {
			require: (id: string) => modules[id],
			console: {
				log: (...parts: unknown[]) => lines.push(parts.join(" ")),
				error: (...parts: unknown[]) => lines.push(`error: ${parts.join(" ")}`),
			},
			process: { exitCode: undefined },
		}) as Promise<void>;
		await finished;
		expect(lines.at(-1)).toMatch(/^Cash left: /);
	});
});
