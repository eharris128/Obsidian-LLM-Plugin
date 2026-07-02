import { Menu, TAbstractFile } from "obsidian";

/**
 * Minimal typed views of undocumented Obsidian internals.
 *
 * The community-review preset bans `as any`, so internals are accessed via
 * `as unknown as <Interface>` against these structural shapes instead. Each
 * interface declares only the members this plugin actually reads — nothing
 * here is a public API, and shapes are verified against the Obsidian builds
 * we support rather than any published typings.
 */

/** `app.setting` — the core settings modal handle. */
export interface AppWithSetting {
	setting: {
		open(): void;
		openTabById(id: string): void;
		containerEl?: HTMLElement;
	};
}

/** `app.commands` — the command registry. */
export interface AppWithCommands {
	commands: {
		executeCommandById(id: string): boolean;
	};
}

/** `app.internalPlugins` — core-plugin registry (file explorer reveal). */
export interface AppWithInternalPlugins {
	internalPlugins: {
		getPluginById(id: string):
			| { instance?: { revealInFolder(file: TAbstractFile): void } }
			| null
			| undefined;
	};
}

/** Desktop `vault.adapter` — OS base path accessors (absent on mobile). */
export interface AdapterWithBasePath {
	basePath?: string;
	getBasePath?(): string;
}

/** `workspace.rightSplit` — right sidebar split with collapse state. */
export interface WorkspaceWithRightSplit {
	rightSplit?: {
		collapsed: boolean;
		expand(): void;
		collapse(): void;
	};
}

/** `MenuItem.setSubmenu()` — runtime API (Obsidian 1.4+) without public types. */
export interface MenuItemWithSubmenu {
	setSubmenu(): Menu;
}
