import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

// The obsidianmd recommended preset runs at its default severities and the
// lint script enforces --max-warnings=0, so any regression in a
// scorecard-relevant category fails locally before the community scanner
// sees it. Every scanner category from the 2026-07 remediation
// (docs/plans/2026-07-01-001-fix-obsidian-scorecard-warnings-plan.md) is at
// zero; the rules explicitly disabled below are NOT part of the scanner's
// inventory and are deferred follow-up work, not suppressed findings.
export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
			sourceType: "module",
		},
		rules: {
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
			"@typescript-eslint/no-wrapper-object-types": "off",
			// Scorecard-flagged rules — remediated to zero, now locked at error.
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-empty-object-type": "error",
			"@typescript-eslint/no-require-imports": "error",
			"@typescript-eslint/no-unused-expressions": "error",
			// Obsidian best-practice rules shared with the sister plugins.
			"prefer-const": "error",
			"eqeqeq": ["error", "smart"],
			"no-console": "error",
			// ── Deferred follow-up (not in the community scanner's inventory) ──
			// The unsafe-* family fires on legacy any-typed data paths (old
			// in-settings history, provider glue) — burn down incrementally.
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			// ~98 UI strings need a copy pass before enabling sentence-case.
			"obsidianmd/ui/sentence-case": "off",
			// createEl migration for legacy createElement call sites.
			"obsidianmd/prefer-create-el": "off",
			// getSettingDefinitions() is a 1.13+ settings-search API; adopt when
			// minAppVersion moves to 1.13.
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
	{
		// The logger module is the one sanctioned place to call console.*.
		files: ["src/utils/logger.ts"],
		rules: {
			"no-console": "off",
			// rule-custom-message re-reports the same console usage.
			"obsidianmd/rule-custom-message": "off",
		},
	},
	{
		// Type-aware linting, scoped to the one type-checked rule we care about
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-unnecessary-type-assertion": "error",
		},
	},
	{
		ignores: ["node_modules/", "main.js"],
	},
);
