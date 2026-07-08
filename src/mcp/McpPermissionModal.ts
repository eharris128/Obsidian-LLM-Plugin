import { App, ButtonComponent, Modal } from "obsidian";

/**
 * Confirmation gate for destructive MCP tool calls (create/edit/move/delete).
 * Unlike the in-chat permission card (ChatContainer.showPermissionUI), an MCP
 * request has no open conversation to render into — it can arrive at any time
 * from an external client — so this uses a real Modal instead. Dismissing
 * without an explicit choice (Escape, backdrop click) resolves to deny.
 */
export class McpPermissionModal extends Modal {
	private decided = false;

	constructor(
		app: App,
		private toolName: string,
		private description: string,
		private input: Record<string, unknown>,
		private onDecision: (approved: boolean) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: `MCP tool request: ${this.toolName}` });
		contentEl.createEl("p", { text: this.description });

		const inputEntries = Object.entries(this.input);
		if (inputEntries.length > 0) {
			const pre = contentEl.createEl("pre", { cls: "llm-mcp-permission-input" });
			pre.createEl("code", { text: JSON.stringify(this.input, null, 2) });
		}

		const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

		new ButtonComponent(buttonRow)
			.setButtonText("Deny")
			.onClick(() => {
				this.decided = true;
				this.close();
				this.onDecision(false);
			});

		new ButtonComponent(buttonRow)
			.setButtonText("Allow")
			.setCta()
			.onClick(() => {
				this.decided = true;
				this.close();
				this.onDecision(true);
			});
	}

	onClose() {
		this.contentEl.empty();
		if (!this.decided) {
			this.decided = true;
			this.onDecision(false);
		}
	}
}

/** Shows the permission modal and resolves once the user makes a choice (or dismisses it, which denies). */
export function requestMcpApproval(
	app: App,
	toolName: string,
	description: string,
	input: Record<string, unknown>
): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		new McpPermissionModal(app, toolName, description, input, resolve).open();
	});
}
