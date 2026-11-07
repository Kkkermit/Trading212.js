import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist", "coverage", "docs-site", "node_modules", "openapi", "src/**/*.generated.ts"] },
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
	{
		languageOptions: {
			parserOptions: { projectService: { allowDefaultProject: ["*.mjs"] }, tsconfigRootDir: import.meta.dirname },
		},
		rules: {
			"no-console": "error",
			"@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
			// Numbers and booleans in template literals read naturally in error messages.
			"@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true, allowBoolean: true }],
		},
	},
	{
		// Tests reach into mocks and fixtures whose shapes are deliberately loose.
		files: ["tests/**/*.ts"],
		rules: {
			"@typescript-eslint/no-non-null-assertion": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/no-empty-function": "off",
			// The pies tests exercise endpoints Trading 212 has deprecated, on purpose.
			"@typescript-eslint/no-deprecated": "off",
		},
	},
	{
		// Scripts, examples and the CLI talk to a terminal.
		files: ["scripts/**/*.ts", "examples/**/*.ts", "src/cli/**/*.ts"],
		rules: { "no-console": "off" },
	},
	{ files: ["**/*.mjs", "**/*.cjs"], ...tseslint.configs.disableTypeChecked },
	{
		files: ["scripts/*.mjs", "scripts/*.cjs"],
		languageOptions: { globals: { console: "readonly", require: "readonly" } },
		rules: { "no-console": "off", "@typescript-eslint/no-require-imports": "off" },
	},
	{ files: ["scripts/*.cjs"], languageOptions: { sourceType: "commonjs" } },
	prettier,
);
