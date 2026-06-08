import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
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
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-empty-object-type": "off",
			"@typescript-eslint/no-require-imports": "off",
			"@typescript-eslint/no-unused-expressions": "off",
			"@typescript-eslint/no-wrapper-object-types": "off",
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
