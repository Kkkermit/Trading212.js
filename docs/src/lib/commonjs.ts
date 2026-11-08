// Turns a TypeScript example into the CommonJS JavaScript the docs show beside it: types removed, imports as
// require(), and code that awaits at the top level moved into an async main(), which CommonJS needs.
import { format } from "prettier";
import ts from "typescript";

export const PRETTIER = { useTabs: true, printWidth: 90, trailingComma: "all", arrowParens: "always" } as const;

// The compiler drops blank lines, so each one is marked first and put back afterwards.
const BLANK = "/*blank*/";

function requireFor(declaration: ts.ImportDeclaration): string {
	const from = (declaration.moduleSpecifier as ts.StringLiteral).text;
	const call = `require(${JSON.stringify(from)})`;
	const clause = declaration.importClause;
	if (!clause) return `${call};`;
	const bindings = clause.namedBindings;
	if (bindings && ts.isNamespaceImport(bindings)) return `const ${bindings.name.text} = ${call};`;
	const names = bindings?.elements.map((element) =>
		element.propertyName ? `${element.propertyName.text}: ${element.name.text}` : element.name.text,
	);
	if (clause.name && names?.length) {
		return `const ${clause.name.text} = ${call};\nconst { ${names.join(", ")} } = ${clause.name.text};`;
	}
	if (clause.name) return `const ${clause.name.text} = ${call};`;
	return `const { ${(names ?? []).join(", ")} } = ${call};`;
}

/** True when a statement awaits outside any function of its own. */
function awaitsAtTopLevel(node: ts.Node): boolean {
	if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
	if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) return true;
	return ts.forEachChild(node, awaitsAtTopLevel) ?? false;
}

/** The CommonJS JavaScript for a TypeScript example, formatted as the docs show it. */
export async function toCommonJs(typescript: string): Promise<string> {
	const marked = typescript
		.split("\n")
		.map((line) => (line.trim() === "" ? BLANK : line))
		.join("\n");
	const emitted = ts.transpileModule(marked, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
	}).outputText;

	const file = ts.createSourceFile("example.js", emitted, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
	const requires: string[] = [];
	const body: string[] = [];
	let wrap = false;
	for (const statement of file.statements) {
		if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
			throw new Error("An example cannot export anything: its JavaScript is a CommonJS script.");
		}
		const leading = emitted.slice(statement.getFullStart(), statement.getStart());
		if (ts.isImportDeclaration(statement)) {
			requires.push(`${leading}${requireFor(statement)}`);
			continue;
		}
		wrap ||= awaitsAtTopLevel(statement);
		body.push(emitted.slice(statement.getFullStart(), statement.getEnd()));
	}
	const program = wrap
		? `${requires.join("")}\n\nasync function main() {${body.join("")}\n}\n\nmain().catch((error) => {\n\tconsole.error(error);\n\tprocess.exitCode = 1;\n});\n`
		: `${requires.join("")}${body.join("")}\n`;

	return (await format(program, { ...PRETTIER, parser: "babel" }))
		.split("\n")
		.map((line) => (line.trim() === BLANK ? "" : line))
		.join("\n")
		.replace(/\{\n\n+/g, "{\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
