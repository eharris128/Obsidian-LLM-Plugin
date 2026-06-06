import { browser, expect } from "@wdio/globals";
import "wdio-obsidian-service";
import { PLUGIN_ID, TAB_VIEW_TYPE } from "./helpers.js";

describe("modal and panels", function () {
	it("open-llm-modal shows the chat modal", async function () {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:open-llm-modal`);
		const modal = browser.$(".modal-container .modal");
		await expect(modal).toBeDisplayed();
		await expect(modal.$("textarea.llm-modal-chat-prompt-text-area")).toExist();

		await browser.keys("Escape");
		await expect(browser.$(".modal-container")).not.toExist();
	});

	it("open-chats-panel opens the chats sidebar view", async function () {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:open-chats-panel`);
		const leaf = browser.$('.workspace-leaf-content[data-type="llm-chats-view"]');
		await expect(leaf).toExist();
	});

	it("open-chat-details-panel opens the details sidebar view", async function () {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:open-chat-details-panel`);
		const leaf = browser.$('.workspace-leaf-content[data-type="llm-chat-details-view"]');
		await expect(leaf).toExist();
	});

	it("widget header settings button reveals the settings panel", async function () {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:open-LLM-widget-tab`);
		const leaf = browser.$(`.workspace-leaf-content[data-type="${TAB_VIEW_TYPE}"]`);
		const settingsPanel = leaf.$(".llm-widget-settings-container");

		await leaf.$(".settings-button").click();
		await expect(settingsPanel).toBeDisplayed();

		// Clicking again toggles back to the chat.
		await leaf.$(".settings-button").click();
		await expect(settingsPanel).not.toBeDisplayed();
		await expect(leaf.$(".llm-widget-chat-container")).toBeDisplayed();
	});
});
