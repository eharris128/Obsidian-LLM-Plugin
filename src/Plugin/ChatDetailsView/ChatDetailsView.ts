import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import LLMPlugin from "main";
import { CHAT_DETAILS_VIEW_TYPE } from "utils/constants";
import { getViewInfo } from "utils/utils";

export { CHAT_DETAILS_VIEW_TYPE };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatDetailsState {
	/** Display name of the active model or assistant */
	modelLabel: string;
	/** True when the model label is an assistant name (not a raw model) */
	isAssistant: boolean;
	/** Active assistant id (for icon/accent styling) */
	assistantId: string | null;
	/** Active project name */
	projectName: string | null;
	/** Memory strings recalled this turn */
	recalledMemories: string[];
	/** Files currently attached as context (display names + paths) */
	contextFiles: { name: string; path: string }[];
}

const EMPTY_STATE: ChatDetailsState = {
	modelLabel: "",
	isAssistant: false,
	assistantId: null,
	projectName: null,
	recalledMemories: [],
	contextFiles: [],
};

// ── ChatDetailsView ────────────────────────────────────────────────────────────

/**
 * ChatDetailsView — a right-sidebar panel that reflects the live state of the
 * active chat: the current model / assistant, recalled memories, and context files.
 *
 * State is pushed in via `updateState()` by ChatContainer after every relevant
 * change (chip sync, memory recall, model switch). The view just renders
 * whatever it's given — it holds no domain logic itself.
 *
 * DOM follows Obsidian's nav-header / nav-files-container / tree-item patterns
 * so it integrates seamlessly with the rest of the sidebar chrome.
 */
export class ChatDetailsView extends ItemView {
	plugin: LLMPlugin;
	private state: ChatDetailsState = { ...EMPTY_STATE };

	// Section containers — rebuilt on each render
	private detailsBodyEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LLMPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string  { return CHAT_DETAILS_VIEW_TYPE; }
	getDisplayText(): string { return "Chat Details"; }
	getIcon(): string { return "message-circle-warning"; }

	async onOpen() {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass("llm-chat-details-root");

		this.detailsBodyEl = root.createDiv({ cls: "llm-chat-details-content" });
		this.renderState();

		// Re-render whenever the active model/assistant changes through settings
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				// Refresh from the active ChatContainer if available
				this.refreshFromPlugin();
			})
		);
	}

	/**
	 * Push new state into the view and re-render. Called by ChatContainer
	 * after every sync (chip strip, memory recall, model/assistant switch).
	 */
	updateState(partial: Partial<ChatDetailsState>) {
		this.state = { ...this.state, ...partial };
		this.renderState();
	}

	/** Reset to the empty/idle state (called on newChat()). */
	clearState() {
		this.state = { ...EMPTY_STATE };
		this.renderState();
	}

	// ── Refresh from plugin settings ──────────────────────────────────────────

	/**
	 * Pull the current model/assistant from plugin settings so the panel stays
	 * accurate even when no ChatContainer has explicitly pushed a state update.
	 */
	refreshFromPlugin() {
		// Use the widget's settings as the canonical "active chat" source
		const viewInfo = getViewInfo(this.plugin, "widget");
		const assistantId = this.plugin.settings.assistantSettings?.activeAssistantId ?? null;
		const assistant = assistantId
			? (this.plugin.assistantManager?.getAssistant(assistantId) ?? null)
			: null;
		const projectId = this.plugin.settings.projectSettings?.activeProjectId ?? null;
		const project = projectId
			? (this.plugin.projectManager?.getProject(projectId) ?? null)
			: null;

		this.updateState({
			modelLabel: assistant?.name ?? viewInfo.modelName ?? "",
			isAssistant: !!assistant,
			assistantId: assistant?.id ?? null,
			projectName: project?.name ?? null,
		});
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	private renderState() {
		if (!this.detailsBodyEl) return;
		this.detailsBodyEl.empty();

		this.renderModelSection();
		this.renderMemoriesSection();
		this.renderContextFilesSection();
	}

	// ── Model / Assistant section ─────────────────────────────────────────────

	private renderModelSection() {
		if (!this.detailsBodyEl) return;

		const section = this.buildSection(this.detailsBodyEl, "Active Model");

		if (!this.state.modelLabel) {
			this.buildEmptyRow(section, "No active chat");
			return;
		}

		const row = section.createDiv({ cls: "llm-chat-details-row" });

		const iconEl = row.createDiv({ cls: "llm-chat-details-row-icon" });
		setIcon(iconEl, this.state.isAssistant ? "bot" : "cpu");
		if (this.state.isAssistant) {
			iconEl.addClass("llm-chat-details-row-icon--assistant");
		}

		const body = row.createDiv({ cls: "llm-chat-details-row-body" });

		body.createDiv({
			cls: "llm-chat-details-row-title" +
				(this.state.isAssistant ? " llm-chat-details-row-title--assistant" : ""),
			text: this.state.modelLabel,
		});

		if (this.state.isAssistant) {
			body.createDiv({
				cls: "llm-chat-details-row-subtitle",
				text: "Assistant",
			});
		} else {
			body.createDiv({
				cls: "llm-chat-details-row-subtitle",
				text: "Model",
			});
		}

		// Project badge — shown in the model section so context is collocated
		if (this.state.projectName) {
			const badge = section.createDiv({ cls: "llm-chat-details-badge-row" });
			const projectBadge = badge.createSpan({
				cls: "tag llm-chat-details-badge llm-chat-details-badge--project",
				text: this.state.projectName,
			});
			const projectIcon = createEl("span");
			setIcon(projectIcon, "folder-open");
			projectBadge.prepend(projectIcon);
		}
	}

	// ── Memories section ──────────────────────────────────────────────────────

	private renderMemoriesSection() {
		if (!this.detailsBodyEl) return;

		const memories = this.state.recalledMemories;
		const section = this.buildSection(
			this.detailsBodyEl,
			"Active Memories",
			memories.length > 0 ? String(memories.length) : undefined
		);

		if (memories.length === 0) {
			this.buildEmptyRow(
				section,
				this.plugin.settings.memorySettings?.enabled
					? "No memories recalled yet"
					: "Memory is disabled"
			);
			return;
		}

		for (const memory of memories) {
			const row = section.createDiv({ cls: "llm-chat-details-row" });

			const iconEl = row.createDiv({ cls: "llm-chat-details-row-icon" });
			setIcon(iconEl, "brain");

			row.createDiv({
				cls: "llm-chat-details-row-body llm-chat-details-row-body--memory",
				text: memory,
			});
		}
	}

	// ── Context files section ─────────────────────────────────────────────────

	private renderContextFilesSection() {
		if (!this.detailsBodyEl) return;

		const files = this.state.contextFiles;
		const section = this.buildSection(
			this.detailsBodyEl,
			"Context Files",
			files.length > 0 ? String(files.length) : undefined
		);

		if (files.length === 0) {
			this.buildEmptyRow(section, "No files attached");
			return;
		}

		for (const file of files) {
			const row = section.createDiv({
				cls: "llm-chat-details-row llm-chat-details-row--clickable",
			});

			const iconEl = row.createDiv({ cls: "llm-chat-details-row-icon" });
			setIcon(iconEl, "file-text");

			const body = row.createDiv({ cls: "llm-chat-details-row-body" });
			body.createDiv({
				cls: "llm-chat-details-row-title",
				text: file.name,
			});
			body.createDiv({
				cls: "llm-chat-details-row-subtitle",
				text: file.path,
			});

			// Clicking a file row opens it in Obsidian
			row.addEventListener("click", () => {
				const tfile = this.app.vault.getAbstractFileByPath(file.path);
				if (tfile) {
					void this.app.workspace.getLeaf(false).openFile(tfile as any);
				}
			});
		}
	}

	// ── DOM helpers ──────────────────────────────────────────────────────────

	/**
	 * Build a labelled section container that matches the Obsidian sidebar
	 * section style (collapsible-style header + content area).
	 */
	private buildSection(
		parent: HTMLElement,
		title: string,
		count?: string
	): HTMLElement {
		const section = parent.createDiv({ cls: "llm-chat-details-section" });

		const header = section.createDiv({ cls: "llm-chat-details-section-header" });
		header.createSpan({ cls: "llm-chat-details-section-title", text: title });

		if (count !== undefined) {
			header.createSpan({ cls: "llm-chat-details-section-count", text: count });
		}

		const body = section.createDiv({ cls: "llm-chat-details-section-body" });
		return body;
	}

	/** Render a muted placeholder row for empty sections. */
	private buildEmptyRow(parent: HTMLElement, text: string) {
		parent.createDiv({ cls: "llm-chat-details-empty", text });
	}

	async onClose() {
		this.detailsBodyEl = null;
	}
}
