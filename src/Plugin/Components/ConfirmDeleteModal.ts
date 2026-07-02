import { App, ButtonComponent, Modal } from "obsidian";

/** Reusable yes/no confirmation modal using Obsidian's native Modal styles. */
export class ConfirmDeleteModal extends Modal {
	private onConfirm: () => void | Promise<void>;

	constructor(app: App, onConfirm: () => void | Promise<void>) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Delete chat?" });
		contentEl.createEl("p", {
			text: "Are you sure you want to delete this chat? This cannot be undone.",
		});

		const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

		new ButtonComponent(buttonRow)
			.setButtonText("Cancel")
			.onClick(() => this.close());

		new ButtonComponent(buttonRow)
			.setButtonText("Delete")
			.setClass("mod-warning")
			.onClick(() => {
				this.close();
				void this.onConfirm();
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
