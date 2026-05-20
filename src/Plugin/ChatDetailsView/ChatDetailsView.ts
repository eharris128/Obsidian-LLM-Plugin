import { ItemView, WorkspaceLeaf } from "obsidian";
import type LLMPlugin from "main";
import { CHAT_DETAILS_VIEW_TYPE } from "utils/constants";
import { renderChatDetailsInto } from "./ChatDetailsRenderer";

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
 * ChatDetailsView — optional right-sidebar panel that reflects the live state
 * of the active chat.  The primary chat details UI is now the inline sidebar
 * inside the widget (llm-widget-details-sidebar).  This ItemView provides the
 * same view for users who prefer a detached right-sidebar panel.
 *
 * Rendering is delegated to ChatDetailsRenderer so both surfaces stay in sync.
 */
export class ChatDetailsView extends ItemView {
	plugin: LLMPlugin;
	private state: ChatDetailsState = { ...EMPTY_STATE };
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

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
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
		const widgetSettings = this.plugin.settings.widgetSettings;
		const assistantId = this.plugin.settings.assistantSettings?.activeAssistantId ?? null;
		const assistant = assistantId
			? (this.plugin.assistantManager?.getAssistant(assistantId) ?? null)
			: null;
		const projectId = this.plugin.settings.projectSettings?.activeProjectId ?? null;
		const project = projectId
			? (this.plugin.projectManager?.getProject(projectId) ?? null)
			: null;

		this.updateState({
			modelLabel: assistant?.name ?? widgetSettings?.modelName ?? "",
			isAssistant: !!assistant,
			assistantId: assistant?.id ?? null,
			projectName: project?.name ?? null,
		});
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	private renderState() {
		if (!this.detailsBodyEl) return;
		renderChatDetailsInto(
			this.detailsBodyEl,
			this.state,
			this.app,
			this.plugin.settings.memorySettings?.enabled ?? false
		);
	}

	async onClose() {
		this.detailsBodyEl = null;
	}
}
