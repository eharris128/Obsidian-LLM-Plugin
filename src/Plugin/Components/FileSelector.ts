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

		this.renderFileList(fileListContainer);

		// Buttons
		const buttonContainer = contentEl.createDiv({
			cls: "llm-file-selector-buttons",
		});

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

			// Checkbox
			const checkbox = fileItem.createEl("input", {
				type: "checkbox",
				cls: "llm-file-selector-checkbox",
			});
			checkbox.checked = this.selectedFiles.has(file.path);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selectedFiles.add(file.path);
				} else {
					this.selectedFiles.delete(file.path);
				}
			});

			// File info
			const fileInfo = fileItem.createDiv({ cls: "llm-file-selector-info" });

			fileInfo.createDiv({
				text: file.name,
				cls: "llm-file-selector-name",
			});

			fileInfo.createDiv({
				text: file.path,
				cls: "llm-file-selector-path llm-text-muted",
			});
		}

		// Selected count
		const countDiv = fileListContainer.createDiv({
			cls: "llm-file-selector-count",
		});
		countDiv.setText(`Selected: ${this.selectedFiles.size} file(s)`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
