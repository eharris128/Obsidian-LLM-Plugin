import { App, Modal, Setting, TextComponent } from "obsidian";
import LLMPlugin from "main";
import { ViewType } from "Types/types";

export class FileSelector extends Modal {
	plugin: LLMPlugin;
	viewType: ViewType;
	selectedFiles: Set<string>;
	searchQuery: string = "";
	onFilesSelected: (files: string[]) => void;

	constructor(
		app: App,
		plugin: LLMPlugin,
		viewType: ViewType,
		currentSelection: string[],
		onFilesSelected: (files: string[]) => void
	) {
		super(app);
		this.plugin = plugin;
		this.viewType = viewType;
		this.selectedFiles = new Set(currentSelection);
		this.onFilesSelected = onFilesSelected;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Select Files for Context" });

		// Search input
		new Setting(contentEl)
			.setName("Search files")
			.setDesc("Filter files by name or path")
			.addText((text: TextComponent) => {
				text.setPlaceholder("Search...");
				text.onChange((value) => {
					this.searchQuery = value.toLowerCase();
					this.renderFileList();
				});
			});

		// File list container
		const fileListContainer = contentEl.createDiv({
			cls: "llm-file-selector-list",
		});
		fileListContainer.style.maxHeight = "400px";
		fileListContainer.style.overflowY = "auto";
		fileListContainer.style.marginTop = "1em";
		fileListContainer.style.marginBottom = "1em";

		this.renderFileList(fileListContainer);

		// Buttons
		const buttonContainer = contentEl.createDiv({
			cls: "llm-file-selector-buttons",
		});
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "0.5em";
		buttonContainer.style.marginTop = "1em";

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		const confirmButton = buttonContainer.createEl("button", {
			text: "Confirm",
			cls: "mod-cta",
		});
		confirmButton.addEventListener("click", () => {
			this.onFilesSelected(Array.from(this.selectedFiles));
			this.close();
		});
	}

	renderFileList(container?: HTMLElement) {
		const fileListContainer =
			container ||
			this.contentEl.querySelector(
				".llm-file-selector-list"
			) as HTMLElement;

		if (!fileListContainer) return;

		fileListContainer.empty();

		// Get all files
		const allFiles = this.app.vault.getFiles();

		// Filter by search query
		const filteredFiles = allFiles.filter((file) => {
			const searchLower = this.searchQuery.toLowerCase();
			return (
				file.name.toLowerCase().includes(searchLower) ||
				file.path.toLowerCase().includes(searchLower)
			);
		});

		// Sort files alphabetically
		filteredFiles.sort((a, b) => a.path.localeCompare(b.path));

		// Display files
		if (filteredFiles.length === 0) {
			fileListContainer.createEl("p", {
				text: "No files found",
				cls: "llm-text-muted",
			});
			return;
		}

		for (const file of filteredFiles) {
			const fileItem = fileListContainer.createDiv({
				cls: "llm-file-selector-item",
			});
			fileItem.style.display = "flex";
			fileItem.style.alignItems = "center";
			fileItem.style.padding = "0.5em";
			fileItem.style.borderBottom = "1px solid var(--background-modifier-border)";

			// Checkbox
			const checkbox = fileItem.createEl("input", {
				type: "checkbox",
			});
			checkbox.checked = this.selectedFiles.has(file.path);
			checkbox.style.marginRight = "0.5em";
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selectedFiles.add(file.path);
				} else {
					this.selectedFiles.delete(file.path);
				}
			});

			// File info
			const fileInfo = fileItem.createDiv();
			fileInfo.style.flex = "1";

			const fileName = fileInfo.createEl("div", {
				text: file.name,
			});
			fileName.style.fontWeight = "500";

			const filePath = fileInfo.createEl("div", {
				text: file.path,
				cls: "llm-text-muted",
			});
			filePath.style.fontSize = "0.9em";
		}

		// Selected count
		const countDiv = fileListContainer.createDiv({
			cls: "llm-file-selector-count",
		});
		countDiv.style.marginTop = "1em";
		countDiv.style.textAlign = "center";
		countDiv.style.fontWeight = "500";
		countDiv.setText(`Selected: ${this.selectedFiles.size} file(s)`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
