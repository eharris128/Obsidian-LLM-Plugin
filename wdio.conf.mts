import * as path from "path";

// Override locally e.g.: OBSIDIAN_APP_VERSION=earliest npm run test:e2e
const appVersion = process.env.OBSIDIAN_APP_VERSION ?? "latest";
const installerVersion = process.env.OBSIDIAN_INSTALLER_VERSION ?? "latest";

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: ["./test/specs/**/*.e2e.ts"],
	// Each spec file gets its own sandboxed Obsidian instance; this many run in parallel.
	maxInstances: 4,

	capabilities: [
		{
			browserName: "obsidian",
			browserVersion: appVersion,
			"wdio:obsidianOptions": {
				installerVersion: installerVersion,
				// Staged by scripts/stage-plugin.mjs — never point this at "." or the
				// developer's real data.json (API keys) gets copied into test vaults.
				plugins: ["./test/plugin-dist"],
				vault: "test/vaults/simple",
			},
		},
	],

	services: ["obsidian"],
	reporters: ["obsidian"],

	// Downloaded Obsidian installers + app bundles (~150MB) cache here.
	cacheDir: path.resolve(".obsidian-cache"),
	outputDir: "test/logs",

	mochaOpts: {
		ui: "bdd",
		timeout: 60000,
	},
	logLevel: "warn",
};
