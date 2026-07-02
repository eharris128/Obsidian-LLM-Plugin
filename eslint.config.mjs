import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

// Migration window: the scorecard's rule set (obsidianmd recommended preset +
// re-enabled typescript-eslint rules) runs at "warn" severity so `npm run lint`
// stays green while the warning categories are burned down unit by unit. The
// final ratchet raises severities back to the preset defaults and adds
// --max-warnings=0 to the lint script.
const asWarnings = (configs) =>
	configs.map((config) => {
		if (!config.rules) return config;
		return {
			...config,
			rules: Object.fromEntries(
				Object.entries(config.rules).map(([id, severity]) => {
					if (severity === "error" || severity === 2) return [id, "warn"];
					if (
						Array.isArray(severity) &&
						(severity[0] === "error" || severity[0] === 2)
					) {
						return [id, ["warn", ...severity.slice(1)]];
					}
					return [id, severity];
				}),
			),
		};
	});

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	...asWarnings(obsidianmd.configs.recommended),
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
			// Scorecard-flagged rules, re-enabled at warn for the migration window.
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-empty-object-type": "warn",
			"@typescript-eslint/no-require-imports": "warn",
			"@typescript-eslint/no-unused-expressions": "warn",
			// Re-enabled as warnings (not errors, so `npm run lint` stays green) to
			// guide gradual cleanup — these mirror the Obsidian best-practice rules
			// enforced by the sister plugins.
			"prefer-const": "warn",
			"eqeqeq": ["warn", "smart"],
			"no-console": "warn",
		},
	},
	{
		// The logger module is the one sanctioned place to call console.*.
		files: ["src/utils/logger.ts"],
		rules: { "no-console": "off" },
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
