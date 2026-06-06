import { browser, expect } from "@wdio/globals";
import "wdio-obsidian-service";
import { PLUGIN_ID, TAB_VIEW_TYPE } from "./helpers.js";

describe("slash command menu", function () {
	before(async function () {
		// Built-in skills are seeded async on layout-ready (rootVaultFolder is
		// set by the staged test data.json); wait for the registry to populate.
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
		await browser.executeObsidianCommand(`${PLUGIN_ID}:open-LLM-widget-tab`);
	});

	it("opens on '/' and closes on Escape", async function () {
		const textarea = browser.$(
			`.workspace-leaf-content[data-type="${TAB_VIEW_TYPE}"] textarea.llm-widget-chat-prompt-text-area`
		);
		await textarea.click();
		await browser.keys("/");

		// The menu element always exists on document.body (display:none when
		// closed), so assert visibility — not existence.
		const menu = browser.$(".llm-slash-menu");
		await expect(menu).toBeDisplayed();
		await expect(menu.$(".llm-slash-menu-item")).toBeDisplayed();

		await browser.keys("Escape");
		await expect(menu).not.toBeDisplayed();
		// Escape must close the menu without wiping the typed text.
		expect(await textarea.getValue()).toBe("/");
	});

	it("filters items as the query narrows and hides when nothing matches", async function () {
		const textarea = browser.$(
			`.workspace-leaf-content[data-type="${TAB_VIEW_TYPE}"] textarea.llm-widget-chat-prompt-text-area`
		);
		await textarea.setValue("/");
		const menu = browser.$(".llm-slash-menu");
		await expect(menu).toBeDisplayed();
		const allCount = (await menu.$$(".llm-slash-menu-item").getElements()).length;
		expect(allCount).toBeGreaterThan(0);

		// A query that can't match any skill id hides the menu entirely.
		await textarea.addValue("zzzznotaskill");
		await expect(menu).not.toBeDisplayed();
	});

	after(async function () {
		await browser.executeObsidian(({ app }, viewType) => {
			app.workspace.detachLeavesOfType(viewType);
		}, TAB_VIEW_TYPE);
	});
});
