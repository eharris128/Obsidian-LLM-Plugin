import { browser, expect } from "@wdio/globals";
import "wdio-obsidian-service";
import { CORE_COMMANDS, PLUGIN_ID } from "./helpers.js";

describe("plugin startup", function () {
	it("loads and enables the plugin", async function () {
		const loaded = await browser.executeObsidian(({ app }, pluginId) => {
			// app.plugins is an undocumented internal API
			const plugins = (app as any).plugins;
			return !!plugins.plugins[pluginId] && plugins.enabledPlugins.has(pluginId);
		}, PLUGIN_ID);
		expect(loaded).toBe(true);
	});

	it("registers its core commands", async function () {
		const commandIds: string[] = await browser.executeObsidian(({ app }) =>
			(app as any).commands.listCommands().map((c: any) => c.id)
		);
		for (const cmd of CORE_COMMANDS) {
			expect(commandIds).toContain(`${PLUGIN_ID}:${cmd}`);
		}
	});

	it("seeds built-in skills under the configured root folder", async function () {
		// stage-plugin.mjs sets rootVaultFolder: "AI", which triggers
		// seedBuiltinSkills() on layout-ready. Poll briefly since seeding is async.
		await browser.waitUntil(
			async () => {
				const count = await browser.executeObsidian(({ app }, pluginId) => {
					const plugin = (app as any).plugins.plugins[pluginId];
					return plugin?.skillRegistry?.getSkills()?.length ?? 0;
				}, PLUGIN_ID);
				return count > 0;
			},
			{ timeout: 15000, timeoutMsg: "expected built-in skills to be seeded" }
		);
	});
});
