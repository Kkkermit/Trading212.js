// Runs a script of the docs site in docs/, installing the site's own dependencies first if they are missing.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const SCRIPTS = new Set(["dev", "build", "preview", "check"]);
const docs = fileURLToPath(new URL("../docs/", import.meta.url));
const script = process.argv[2] ?? "";

if (!SCRIPTS.has(script)) {
	console.error(`Usage: node scripts/docs.mjs <${[...SCRIPTS].join("|")}>`);
	process.exit(2);
}

const required = JSON.parse(readFileSync(new URL("../docs/package.json", import.meta.url), "utf8")).engines.node;
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const [needMajor, needMinor, needPatch] = required.replace(">=", "").split(".").map(Number);
const tooOld = major === needMajor && (minor < needMinor || (minor === needMinor && patch < needPatch));
if (major < needMajor || tooOld) {
	console.error(
		`The docs site needs Node ${required}, and this is ${process.versions.node}. Update Node and try again.`,
	);
	process.exit(1);
}

// npm sets npm_execpath to its own entry point, which runs the same on every platform without a shell.
const npmCli = process.env.npm_execpath;
if (!npmCli) {
	console.error("Run this through npm, such as `npm run docs:dev`.");
	process.exit(2);
}
const npm = (...args) => {
	const { status } = spawnSync(process.execPath, [npmCli, ...args], { cwd: docs, stdio: "inherit" });
	if (status !== 0) process.exit(status ?? 1);
};

if (!existsSync(new URL("../docs/node_modules/astro/package.json", import.meta.url))) {
	console.log("Installing the docs site's dependencies, once…");
	npm("ci", "--no-audit", "--no-fund");
}
npm("run", script);
