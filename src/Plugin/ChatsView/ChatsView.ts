import {
	ExtraButtonComponent,
	ItemView,
	SearchComponent,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import LLMPlugin from "main";
import { CHATS_VIEW_TYPE } from "utils/constants";
import { attachChatRowMenu } from "Plugin/Components/ChatRowMenuHelper";

export { CHATS_VIEW_TYPE };

/**
 * ChatsView — a dedicated sidebar panel that lists all LLM conversations from
 * every location (default chat folder + all project chats folders), sorted
 * newest-first. Clicking a chat opens it in the chat widget tab.
 *
 * Uses Obsidian's native DOM patterns:
 *  - nav-header / nav-buttons-container / nav-action-button for the toolbar
 *  - SearchComponent for the search box (renders search-input-container)
 *  - ExtraButtonComponent for icon-only buttons
 *  - tree-item / tree-item-self / tree-item-inner for list rows (file-explorer pattern)
 *  - tree-item-flair for the right-side date stamp
 *  - .tag for project / agent badges
 *  - pane-empty for the empty state
 */
export class ChatsView extends ItemView {
	plugin: LLMPlugin;
	private listEl: HTMLElement | null = null;
	private searchComponent: SearchComponent | null = null;
	private allFiles: TFile[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: LLMPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return CHATS_VIEW_TYPE; }
	getDisplayText(): string { return "Chats"; }
	getIcon(): string { return "messages-square"; }

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();

		// ── Toolbar ───────────────────────────────────────────────────────────
		// Matches Obsidian's file-explorer and bookmarks header pattern.
		const navHeader = container.createDiv({ cls: "nav-header" });
		const navBtns = navHeader.createDiv({ cls: "nav-buttons-container" });

		const newChatBtn = new ExtraButtonComponent(navBtns);
		newChatBtn.setIcon("square-pen");
		newChatBtn.setTooltip("New chat");
		newChatBtn.extraSettingsEl.addClass("nav-action-button");
		newChatBtn.onClick(() => void this.plugin.activateTab());

		// ── Search ─────────────────────────────────────────────────────────────
		// SearchComponent renders Obsidian's native search-input-container with
		// the magnifier icon and clear button already wired up.
		this.searchComponent = new SearchComponent(container);
		this.searchComponent.setPlaceholder("Search chats…");
		this.searchComponent.onChange(() => this.applyFilter());

		// ── Chat list ──────────────────────────────────────────────────────────
		// nav-files-container gives us the correct scrollable list styling.
		this.listEl = container.createDiv({ cls: "nav-files-container" });

		await this.refresh();

		// Auto-refresh when vault chat files are created / modified / deleted / renamed.
		this.registerEvent(this.app.vault.on("create", async (f) => {
			if (this.isChatFile(f.path)) await this.refresh();
		}));
		this.registerEvent(this.app.vault.on("modify", async (f) => {
			if (this.isChatFile(f.path)) await this.refresh();
		}));
		this.registerEvent(this.app.vault.on("delete", async () => {
			await this.refresh();
		}));
		this.registerEvent(this.app.vault.on("rename", async () => {
			await this.refresh();
		}));
	}

	/** True when the path belongs to one of the chat folders managed by ChatHistory. */
	private isChatFile(path: string): boolean {
		if (!path.endsWith(".md")) return false;
		const chatFolder = (this.plugin.settings.chatHistoryFolder || "LLM Chats") + "/";
		const projectsFolder = this.plugin.projectsFolder + "/";
		if (path.startsWith(chatFolder)) return true;
		if (path.startsWith(projectsFolder)) {
			const relative = path.slice(projectsFolder.length);
			const parts = relative.split("/");
			// Projects/<id>/chats/<file>.md — exactly 3 segments deep
			return parts.length === 3 && parts[1] === "chats";
		}
		return false;
	}

	/** Reload all chat files from the vault and re-render. */
	async refresh() {
		if (!this.listEl) return;
		try {
			this.allFiles = await this.plugin.chatHistory.list();
		} catch (e) {
			console.error("[ChatsView] Failed to list chat files:", e);
			this.allFiles = [];
		}
		this.applyFilter();
	}

	/** Filter by current search query and re-render. */
	private applyFilter() {
		if (!this.listEl) return;
		const query = (this.searchComponent?.getValue() ?? "").toLowerCase().trim();
		const filtered = query
			? this.allFiles.filter((f) =>
					this.getTitle(f).toLowerCase().includes(query) ||
					(this.getProject(f) ?? "").toLowerCase().includes(query)
			  )
			: this.allFiles;
		this.renderList(filtered);
	}

	// ── Metadata helpers ──────────────────────────────────────────────────────

	private getTitle(file: TFile): string {
		return (
			(this.app.metadataCache.getFileCache(file)?.frontmatter?.title as string | undefined) ??
			file.basename
		);
	}

	private getProject(file: TFile): string | null {
		return (this.app.metadataCache.getFileCache(file)?.frontmatter?.project as string) ?? null;
	}

	private isAgent(file: TFile): boolean {
		return !!(this.app.metadataCache.getFileCache(file)?.frontmatter?.agent);
	}

	private formatDate(mtime: number): string {
		const diff = Date.now() - mtime;
		const mins  = Math.floor(diff / 60_000);
		const hours = Math.floor(diff / 3_600_000);
		const days  = Math.floor(diff / 86_400_000);
		if (mins  < 1)  return "just now";
		if (mins  < 60) return `${mins}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days  === 1) return "yesterday";
		if (days  < 7)  return `${days}d ago`;
		return new Date(mtime).toLocaleDateString(undefined, { month: "short", day: "numeric" });
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	private renderList(files: TFile[]) {
		if (!this.listEl) return;
		this.listEl.empty();

		if (!files.length) {
			// pane-empty is Obsidian's native empty-state class (used by file explorer, etc.)
			this.listEl.createDiv({
				cls: "pane-empty",
				text: this.searchComponent?.getValue()?.trim()
					? "No chats match your search."
					: "No conversations yet.\nStart chatting to see them here.",
			});
			return;
		}

		for (const file of files) {
			const title   = this.getTitle(file);
			const project = this.getProject(file);
			const agent   = this.isAgent(file);

			// Outer wrapper — tree-item nav-file mirrors the file-explorer row structure.
			const item = this.listEl.createDiv({ cls: "tree-item nav-file" });

			// Clickable row — Obsidian's hover/active/focus styles are applied automatically.
			const itemSelf = item.createDiv({ cls: "tree-item-self nav-file-title is-clickable" });
			itemSelf.setAttr("tabindex", "0");

			// Left icon (chat bubble or agent routing icon)
			const iconEl = itemSelf.createDiv({ cls: "tree-item-icon llm-chats-row-icon" });
			setIcon(iconEl, agent ? "waypoints" : "message-square");

			// Centre: title + optional badge row
			const inner = itemSelf.createDiv({ cls: "tree-item-inner" });
			inner.createDiv({ cls: "tree-item-inner-text", text: title });

			if (project || agent) {
				const meta = inner.createDiv({ cls: "llm-chats-meta" });
				if (project) {
					// .tag is Obsidian's native pill class (used in tag pane, properties, etc.)
					meta.createSpan({ cls: "tag llm-chats-tag-project", text: project });
				}
				if (agent) {
					meta.createSpan({ cls: "tag llm-chats-tag-agent", text: "Agent" });
				}
			}

			// Right flair: date stamp + three-dot context-menu button.
			// The button is hidden by default and shown on row-hover via CSS.
			const flairOuter = itemSelf.createDiv({ cls: "tree-item-flair-outer" });
			flairOuter.createSpan({
				cls: "tree-item-flair llm-chats-row-date",
				text: this.formatDate(file.stat.mtime),
			});

			attachChatRowMenu(itemSelf, flairOuter, file, this.plugin, () => void this.refresh());

			itemSelf.addEventListener("click", () => {
				void this.plugin.openChatFileInWidget(file.path);
			});
		}
	}

	async onClose() {
		this.listEl = null;
		this.searchComponent = null;
		this.allFiles = [];
	}
}
