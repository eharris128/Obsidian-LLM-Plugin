import { setIcon } from "obsidian";
import type { App } from "obsidian";
import type { ChatDetailsState } from "./ChatDetailsView";

/**
 * Pure DOM renderer for Chat Details state.
 * Used by both ChatDetailsView (Obsidian right-sidebar panel) and the
 * inline widget sidebar so the two never diverge.
 */
export function renderChatDetailsInto(
	el: HTMLElement,
	state: ChatDetailsState,
	app: App,
	memoryEnabled = false
): void {
	el.empty();
	renderModelSection(el, state);
	renderMemoriesSection(el, state, memoryEnabled);
	renderContextFilesSection(el, state, app);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function buildSection(
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
	return section.createDiv({ cls: "llm-chat-details-section-body" });
}

function buildEmptyRow(parent: HTMLElement, text: string) {
	parent.createDiv({ cls: "llm-chat-details-empty", text });
}

// ── Model / Assistant section ─────────────────────────────────────────────────

function renderModelSection(el: HTMLElement, state: ChatDetailsState) {
	const section = buildSection(el, "Active Model");

	if (!state.modelLabel) {
		buildEmptyRow(section, "No active chat");
		return;
	}

	const row = section.createDiv({ cls: "llm-chat-details-row" });

	const iconEl = row.createDiv({ cls: "llm-chat-details-row-icon" });
	setIcon(iconEl, state.isAssistant ? "bot" : "cpu");
	if (state.isAssistant) iconEl.addClass("llm-chat-details-row-icon--assistant");

	const body = row.createDiv({ cls: "llm-chat-details-row-body" });
	body.createDiv({
		cls:
			"llm-chat-details-row-title" +
			(state.isAssistant ? " llm-chat-details-row-title--assistant" : ""),
		text: state.modelLabel,
	});
	body.createDiv({
		cls: "llm-chat-details-row-subtitle",
		text: state.isAssistant ? "Assistant" : "Model",
	});

	if (state.projectName) {
		const badge = section.createDiv({ cls: "llm-chat-details-badge-row" });
		const projectBadge = badge.createSpan({
			cls: "tag llm-chat-details-badge llm-chat-details-badge--project",
			text: state.projectName,
		});
		const projectIcon = createEl("span");
		setIcon(projectIcon, "folder-open");
		projectBadge.prepend(projectIcon);
	}
}

// ── Memories section ──────────────────────────────────────────────────────────

function renderMemoriesSection(
	el: HTMLElement,
	state: ChatDetailsState,
	memoryEnabled: boolean
) {
	const memories = state.recalledMemories;
	const section = buildSection(
		el,
		"Active Memories",
		memories.length > 0 ? String(memories.length) : undefined
	);

	if (memories.length === 0) {
		buildEmptyRow(
			section,
			memoryEnabled ? "No memories recalled yet" : "Memory is disabled"
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

// ── Context files section ─────────────────────────────────────────────────────

function renderContextFilesSection(
	el: HTMLElement,
	state: ChatDetailsState,
	app: App
) {
	const files = state.contextFiles;
	const section = buildSection(
		el,
		"Context Files",
		files.length > 0 ? String(files.length) : undefined
	);

	if (files.length === 0) {
		buildEmptyRow(section, "No files attached");
		return;
	}

	for (const file of files) {
		const row = section.createDiv({
			cls: "llm-chat-details-row llm-chat-details-row--clickable",
		});
		const iconEl = row.createDiv({ cls: "llm-chat-details-row-icon" });
		setIcon(iconEl, "file-text");
		const body = row.createDiv({ cls: "llm-chat-details-row-body" });
		body.createDiv({ cls: "llm-chat-details-row-title", text: file.name });
		body.createDiv({ cls: "llm-chat-details-row-subtitle", text: file.path });

		row.addEventListener("click", () => {
			const tfile = app.vault.getAbstractFileByPath(file.path);
			if (tfile) void app.workspace.getLeaf(false).openFile(tfile as any);
		});
	}
}
