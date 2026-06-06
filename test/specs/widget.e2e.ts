import { browser, expect } from "@wdio/globals";
import "wdio-obsidian-service";
import { PLUGIN_ID, TAB_VIEW_TYPE } from "./helpers.js";

async function widgetLeafCount(): Promise<number> {
	return browser.executeObsidian(
		({ app }, viewType) => app.workspace.getLeavesOfType(viewType).length,
		TAB_VIEW_TYPE
	);
}

async function detachWidgetLeaves(): Promise<void> {
	await browser.executeObsidian(
		({ app }, viewType) => app.workspace.detachLeavesOfType(viewType),
		TAB_VIEW_TYPE
	);
}

describe("chat widget", function () {
	beforeEach(async function () {
		await detachWidgetLeaves();
	});

	it("opens a widget tab with the chat UI", async function () {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:open-LLM-widget-tab`);

		const leaf = browser.$(`.workspace-leaf-content[data-type="${TAB_VIEW_TYPE}"]`);
		await expect(leaf).toExist();
		await expect(leaf.$("textarea.llm-widget-chat-prompt-text-area")).toExist();
		await expect(leaf.$(".llm-widget-send-button")).toExist();
		await expect(leaf.$(".llm-widget-messages-div")).toExist();
	});

	it("open-LLM-widget-tab focuses the existing tab instead of opening another", async function () {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:open-LLM-widget-tab`);
		await browser.executeObsidianCommand(`${PLUGIN_ID}:open-LLM-widget-tab`);
		expect(await widgetLeafCount()).toBe(1);
	});

	it("new-chat-widget always creates a fresh tab", async function () {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:new-chat-widget`);
		await browser.executeObsidianCommand(`${PLUGIN_ID}:new-chat-widget`);
		expect(await widgetLeafCount()).toBe(2);
	});

	it("each widget tab owns an isolated chat input", async function () {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:new-chat-widget`);
		await browser.executeObsidianCommand(`${PLUGIN_ID}:new-chat-widget`);

		const textareas = browser.$$(
			`.workspace-leaf-content[data-type="${TAB_VIEW_TYPE}"] textarea.llm-widget-chat-prompt-text-area`
		);
		await expect(textareas).toBeElementsArrayOfSize(2);

		// Tabs share a tab group, so only the active one is visible. Type into
		// it; the hidden sibling's input must stay empty (isolated state).
		const elements = Array.from(await textareas.getElements());
		const visibility: boolean[] = [];
		for (const el of elements) {
			visibility.push(await el.isDisplayed());
		}
		const visible = elements[visibility.indexOf(true)];
		const hidden = elements[visibility.indexOf(false)];
		expect(visible).toBeDefined();
		expect(hidden).toBeDefined();

		await visible.setValue("hello from the active tab");
		expect(await visible.getValue()).toBe("hello from the active tab");
		expect(await hidden.getValue()).toBe("");
	});
});
