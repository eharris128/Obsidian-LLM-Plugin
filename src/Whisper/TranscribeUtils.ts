/**
 * TranscribeUtils — shared helpers for the Whisper feature.
 */

import { Modal, App } from "obsidian";
import type LLMPlugin from "main";

/**
 * If `folderPath` doesn't exist, show a modal asking the user whether to create it.
 * Returns true if the folder exists (or was just created), false if the user declined.
 */
export async function createFolderOrPrompt(
	plugin: LLMPlugin,
	folderPath: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new CreateFolderModal(plugin.app, folderPath, async (confirmed) => {
			if (confirmed) {
				try {
					await plugin.app.vault.adapter.mkdir(folderPath);
					resolve(true);
				} catch {
					resolve(false);
				}
			} else {
				resolve(false);
			}
		});
		modal.open();
	});
}

class CreateFolderModal extends Modal {
	private folderPath: string;
	private onDecision: (confirmed: boolean) => void;

	constructor(
		app:        App,
		folderPath: string,
		callback:   (confirmed: boolean) => void,
	) {
		super(app);
		this.folderPath   = folderPath;
		this.onDecision   = callback;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Create output folder?" });
		contentEl.createEl("p", {
			text: `The folder "${this.folderPath}" doesn't exist. Create it now?`,
		});

		const btnRow = contentEl.createDiv({ cls: "modal-button-container" });

		const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.onDecision(false);
			this.close();
		});

		const confirmBtn = btnRow.createEl("button", {
			text: "Create folder",
			cls:  "mod-cta",
		});
		confirmBtn.addEventListener("click", () => {
			this.onDecision(true);
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
