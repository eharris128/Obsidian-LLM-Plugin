import { Component, ExtraButtonComponent, SearchComponent, TFile, setIcon } from "obsidian";
import LLMPlugin from "main";
import { attachChatRowMenu } from "./ChatRowMenuHelper";

/**
 * ChatsSidebar — inline chats list component for the widget's left-side panel.
 *
 * Renders the full chat history list (all conversations from every location)
 * into a given container element. Used by WidgetView to embed a toggleable
 * chats panel on the left side of the widget body.
 *
 * Follows the same Obsidian DOM patterns as ChatsView:
 *  - nav-header / nav-buttons-container for the toolbar
 *  - SearchComponent for search (renders search-input-container)
 *  - nav-files-container for the scrollable list
 *  - tree-item / tree-item-self / tree-item-inner for list rows
 *  - tree-item-flair for the right-side date stamp
 *  - .tag for project / agent badges
 *  - pane-empty for the empty state
 *
 * Lifecycle: call this.load() via the constructor (done here via super()),
 * then render(el) to populate. Call destroy() to clean up event listeners
 * and DOM references when the parent view closes.
 */
export class ChatsSidebar extends Component {
	private plugin: LLMPlugin;
	private listEl: HTMLElement | null = null;
	private searchComponent: SearchComponent | null = null;
	private allFiles: TFile[] = [];

	/**
	 * Optional callback for when the user clicks a chat row.
	 *
	 * When set (by the parent WidgetView), clicking a chat loads it directly
	 * into that widget's ChatContainer rather than going through the plugin's
	 * openChatFileInWidget() router — which is important when multiple widget
	 * tabs are open and the user wants to load into a specific one.
	 *
	 * If not set, falls back to plugin.openChatFileInWidget().
	 */
	onOpenFile?: (path: string) => Promise<void>;

	constructor(plugin: LLMPlugin) {
		super();
		this.plugin = plugin;
		this.load();
	}

	render(containerEl: HTMLElement) {
		containerEl.empty();

		// ── Toolbar ────────────────────────────────────────────────────────────
		const navHeader = containerEl.createDiv({ cls: "nav-header" });
		const navBtns = navHeader.createDiv({ cls: "nav-buttons-container" });

		const newChatBtn = new ExtraButtonComponent(navBtns);
		newChatBtn.setIcon("square-pen");
		newChatBtn.setTooltip("New chat");
		newChatBtn.extraSettingsEl.addClass("nav-action-button");
		newChatBtn.onClick(() => void this.plugin.activateTab());

		// ── Search ─────────────────────────────────────────────────────────────
		this.searchComponent = new SearchComponent(containerEl);
		this.searchComponent.setPlaceholder("Search chats…");
		this.searchComponent.onChange(() => this.applyFilter());

		// ── Chat list ──────────────────────────────────────────────────────────
		this.listEl = containerEl.createDiv({ cls: "nav-files-container" });

		void this.refresh();

		// Auto-refresh when vault chat files change.
		this.registerEvent(this.plugin.app.vault.on("create", async (f) => {
			if (this.isChatFile(f.path)) await this.refresh();
		}));
		this.registerEvent(this.plugin.app.vault.on("modify", async (f) => {
			if (this.isChatFile(f.path)) await this.refresh();
		}));
		this.registerEvent(this.plugin.app.vault.on("delete", async () => {
			await this.refresh();
		}));
		this.registerEvent(this.plugin.app.vault.on("rename", async () => {
			await this.refresh();
		}));
	}

	destroy() {
		this.unload();
		this.listEl = null;
		this.searchComponent = null;
		this.allFiles = [];
	}

	// ── Path helpers ──────────────────────────────────────────────────────────

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

	// ── Data loading ──────────────────────────────────────────────────────────

	async refresh() {
		if (!this.listEl) return;
		try {
			this.allFiles = await this.plugin.chatHistory.list();
		} catch (e) {
			console.error("[ChatsSidebar] Failed to list chat files:", e);
			this.allFiles = [];
		}
		this.applyFilter();
	}

	private applyFilter() {
		if (!this.listEl) return;
		const query = (this.searchComponent?.getValue() ?? "").toLowerCase().trim();
		const filtered = query
			? this.allFiles.filter(
				(f) =>
					this.getTitle(f).toLowerCase().includes(query) ||
					(this.getProject(f) ?? "").toLowerCase().includes(query)
			)
			: this.allFiles;
		this.renderList(filtered);
	}

	// ── Metadata helpers ──────────────────────────────────────────────────────

	private getTitle(file: TFile): string {
		return (
			(this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
				?.title as string | undefined) ?? file.basename
		);
	}

	private getProject(file: TFile): string | null {
		return (
			(this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
				?.project as string) ?? null
		);
	}

	private isAgent(file: TFile): boolean {
		return !!(
			this.plugin.app.metadataCache.getFileCache(file)?.frontmatter?.agent
		);
	}

	private formatDate(mtime: number): string {
		const diff = Date.now() - mtime;
		const mins = Math.floor(diff / 60_000);
		const hours = Math.floor(diff / 3_600_000);
		const days = Math.floor(diff / 86_400_000);
		if (mins < 1) return "just now";
		if (mins < 60) return `${mins}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days === 1) return "yesterday";
		if (days < 7) return `${days}d ago`;
		return new Date(mtime).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	private renderList(files: TFile[]) {
		if (!this.listEl) return;
		this.listEl.empty();

		if (!files.length) {
			this.listEl.createDiv({
				cls: "pane-empty",
				text: this.searchComponent?.getValue()?.trim()
					? "No chats match your search."
					: "No conversations yet.\nStart chatting to see them here.",
			});
			return;
		}

		for (const file of files) {
			const title = this.getTitle(file);
			const project = this.getProject(file);
			const agent = this.isAgent(file);

			// Outer wrapper — tree-item nav-file mirrors the file-explorer row.
			const item = this.listEl.createDiv({ cls: "tree-item nav-file" });

			// Clickable row — hover/active/focus styles from tree-item-self.
			const itemSelf = item.createDiv({
				cls: "tree-item-self nav-file-title is-clickable",
			});
			itemSelf.setAttr("tabindex", "0");

			// Left icon
			const iconEl = itemSelf.createDiv({
				cls: "tree-item-icon llm-chats-row-icon",
			});
			setIcon(iconEl, agent ? "waypoints" : "message-square");

			// Centre: title + optional badge row
			const inner = itemSelf.createDiv({ cls: "tree-item-inner" });
			inner.createDiv({ cls: "tree-item-inner-text", text: title });

			if (project || agent) {
				const meta = inner.createDiv({ cls: "llm-chats-meta" });
				if (project) {
					meta.createSpan({
						cls: "tag llm-chats-tag-project",
						text: project,
					});
				}
				if (agent) {
					meta.createSpan({ cls: "tag llm-chats-tag-agent", text: "Agent" });
				}
			}

			// Right flair: date stamp + three-dot context-menu button.
			// The button is hidden by default and shown on row-hover via CSS.
			const flairOuter = itemSelf.createDiv({
				cls: "tree-item-flair-outer",
			});
			flairOuter.createSpan({
				cls: "tree-item-flair llm-chats-row-date",
				text: this.formatDate(file.stat.mtime),
			});

			attachChatRowMenu(itemSelf, flairOuter, file, this.plugin, () => void this.refresh());

			itemSelf.addEventListener("click", () => {
				if (this.onOpenFile) {
					void this.onOpenFile(file.path);
				} else {
					void this.plugin.openChatFileInWidget(file.path);
				}
			});
		}
	}
}
