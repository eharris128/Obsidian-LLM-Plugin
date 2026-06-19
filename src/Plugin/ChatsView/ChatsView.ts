import {
	ExtraButtonComponent,
	ItemView,
	Menu,
	SearchComponent,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { logger } from "../../utils/logger";
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
 *  - pane-empty for the empty state
 *  - Menu for the filter dropdown (native Obsidian context menu)
 */
export class ChatsView extends ItemView {
	plugin: LLMPlugin;
	private listEl: HTMLElement | null = null;
	private searchComponent: SearchComponent | null = null;
	private filterBtn: ExtraButtonComponent | null = null;
	private allFiles: TFile[] = [];
	private activeFilter: { type: "project" | "model"; value: string } | null = null;

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

		// Filter button — opens a Menu with dynamic project/model options
		this.filterBtn = new ExtraButtonComponent(navBtns);
		this.filterBtn.setIcon("sliders-horizontal");
		this.filterBtn.setTooltip("Filter chats");
		this.filterBtn.extraSettingsEl.addClass("nav-action-button");
		this.filterBtn.extraSettingsEl.addEventListener("click", (evt) => this.openFilterMenu(evt));

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
			logger.error("[ChatsView] Failed to list chat files:", e);
			this.allFiles = [];
		}
		this.applyFilter();
	}

	/** Opens the native Obsidian Menu with dynamic filter options. */
	private openFilterMenu(evt: MouseEvent) {
		const menu = new Menu();

		// "All chats" — clears the active filter
		menu.addItem((item) => {
			item.setTitle("All chats");
			item.setIcon("messages-square");
			item.setChecked(this.activeFilter === null);
			item.onClick(() => {
				this.activeFilter = null;
				this.updateFilterBtnState();
				this.applyFilter();
			});
		});

		// Collect unique projects from loaded files
		const projects = [...new Set(
			this.allFiles.map((f) => this.getProject(f)).filter((p): p is string => p !== null)
		)].sort();

		if (projects.length > 0) {
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle("Filter by project").setDisabled(true);
			});
			for (const project of projects) {
				menu.addItem((item) => {
					item.setTitle(project);
					item.setIcon("folder");
					item.setChecked(this.activeFilter?.type === "project" && this.activeFilter.value === project);
					item.onClick(() => {
						this.activeFilter = { type: "project", value: project };
						this.updateFilterBtnState();
						this.applyFilter();
					});
				});
			}
		}

		// Collect unique models from loaded files
		const models = [...new Set(
			this.allFiles.map((f) => this.getModel(f)).filter((m): m is string => m !== null)
		)].sort();

		if (models.length > 0) {
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle("Filter by model").setDisabled(true);
			});
			for (const model of models) {
				menu.addItem((item) => {
					item.setTitle(model);
					item.setIcon("cpu");
					item.setChecked(this.activeFilter?.type === "model" && this.activeFilter.value === model);
					item.onClick(() => {
						this.activeFilter = { type: "model", value: model };
						this.updateFilterBtnState();
						this.applyFilter();
					});
				});
			}
		}

		menu.showAtMouseEvent(evt);
	}

	/** Sync the filter button's active state indicator. */
	private updateFilterBtnState() {
		if (!this.filterBtn) return;
		if (this.activeFilter) {
			this.filterBtn.extraSettingsEl.addClass("is-active");
		} else {
			this.filterBtn.extraSettingsEl.removeClass("is-active");
		}
	}

	/** Filter by current search query + active filter, then re-render. */
	private applyFilter() {
		if (!this.listEl) return;
		const query = (this.searchComponent?.getValue() ?? "").toLowerCase().trim();

		let filtered = this.allFiles;

		// Apply active filter
		if (this.activeFilter) {
			const { type, value } = this.activeFilter;
			if (type === "project") {
				filtered = filtered.filter((f) => this.getProject(f) === value);
			} else if (type === "model") {
				filtered = filtered.filter((f) => this.getModel(f) === value);
			}
		}

		// Apply search query
		if (query) {
			filtered = filtered.filter(
				(f) =>
					this.getTitle(f).toLowerCase().includes(query) ||
					(this.getProject(f) ?? "").toLowerCase().includes(query)
			);
		}

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

	private getModel(file: TFile): string | null {
		return (this.app.metadataCache.getFileCache(file)?.frontmatter?.model as string) ?? null;
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
				text: this.activeFilter || this.searchComponent?.getValue()?.trim()
					? "No chats match your filter."
					: "No conversations yet.\nStart chatting to see them here.",
			});
			return;
		}

		for (const file of files) {
			const title = this.getTitle(file);
			const agent = this.isAgent(file);

			// Outer wrapper — tree-item nav-file mirrors the file-explorer row structure.
			const item = this.listEl.createDiv({ cls: "tree-item nav-file" });

			// Clickable row — Obsidian's hover/active/focus styles are applied automatically.
			const itemSelf = item.createDiv({ cls: "tree-item-self nav-file-title is-clickable" });
			itemSelf.setAttr("tabindex", "0");

			// Left icon (chat bubble or agent task-list icon)
			const iconEl = itemSelf.createDiv({ cls: "tree-item-icon llm-chats-row-icon" });
			setIcon(iconEl, agent ? "list-todo" : "message-square");

			// Centre: title only (badges removed)
			const inner = itemSelf.createDiv({ cls: "tree-item-inner" });
			inner.createDiv({ cls: "tree-item-inner-text", text: title });

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
		this.filterBtn = null;
		this.allFiles = [];
		this.activeFilter = null;
	}
}
