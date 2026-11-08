const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "chore", "add", "update", "remove"];

export default {
	rules: {
		"type-enum": [2, "always", TYPES],
		"type-empty": [2, "never"],
		"type-case": [2, "always", "lower-case"],
		"scope-empty": [2, "always"],
		"subject-empty": [2, "never"],
		"subject-case": [2, "always", "sentence-case"],
		"subject-full-stop": [2, "never", "."],
		"header-max-length": [2, "always", 100],
	},
};
