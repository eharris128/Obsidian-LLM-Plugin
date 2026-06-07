import * as fs from "fs";
import * as path from "path";

/**
 * Plugin id read from the staged manifest at runtime — never hardcode it.
 * The primary worktree carries a local-only manifest id ("...-hidden-main")
 * so the same vault can load both worktrees; reading it dynamically keeps the
 * suite working in both.
 */
const manifest = JSON.parse(
	fs.readFileSync(path.resolve("test/plugin-dist/manifest.json"), "utf-8")
) as { id: string };

export const PLUGIN_ID: string = manifest.id;

// Mirrors TAB_VIEW_TYPE in src/utils/constants.ts (specs can't import src/
// directly — it resolves the "obsidian" module, which only exists at runtime
// inside the app).
export const TAB_VIEW_TYPE = "tab-view";

/** Commands the plugin registers unconditionally in main.ts. */
export const CORE_COMMANDS = [
	"open-llm-modal",
	"open-LLM-widget-tab",
	"new-chat-widget",
	"toggle-LLM-fab",
	"open-chats-panel",
	"open-chat-details-panel",
] as const;
