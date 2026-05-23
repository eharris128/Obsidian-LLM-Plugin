import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["src/**/*.ts"],
  extends: [tseslint.configs.recommendedTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: "/sessions/fervent-zen-wozniak/mnt/Obsidian-LLM-Plugin",
    },
  },
  rules: {
    // Only run the one rule we care about
    "@typescript-eslint/no-unnecessary-type-assertion": "error",
  },
});
