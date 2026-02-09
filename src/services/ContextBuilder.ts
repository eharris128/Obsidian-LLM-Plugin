import { App, MarkdownView, TFile } from "obsidian";
import { ContextSettings, VaultContext } from "Types/types";

export class ContextBuilder {
	constructor(private app: App) {}

	/**
	 * Build structured context from Obsidian vault based on settings
	 */
	async buildContext(settings: ContextSettings): Promise<VaultContext | null> {
		const context: VaultContext = {
			additionalFiles: [],
		};

		let hasContext = false;

		// Get active file content
		if (settings.includeActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				try {
					const content = await this.app.vault.read(activeFile);
					context.activeFile = {
						path: activeFile.path,
						name: activeFile.name,
						content,
					};
					hasContext = true;
				} catch (error) {
					console.error("Error reading active file:", error);
				}
			}
		}

		// Get selected text from editor
		if (settings.includeSelection) {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView?.editor) {
				const selection = activeView.editor.getSelection();
				if (selection && selection.trim().length > 0) {
					context.selectedText = selection;
					hasContext = true;
				}
			}
		}

		// Get additional selected files
		if (settings.selectedFiles && settings.selectedFiles.length > 0) {
			for (const filePath of settings.selectedFiles) {
				try {
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (file instanceof TFile) {
						const content = await this.app.vault.read(file);
						context.additionalFiles.push({
							path: file.path,
							name: file.name,
							content,
						});
						hasContext = true;
					}
				} catch (error) {
					console.error(`Error reading file ${filePath}:`, error);
				}
			}
		}

		return hasContext ? context : null;
	}

	/**
	 * Format vault context as structured markdown
	 */
	formatStructuredContext(context: VaultContext): string {
		let formatted = "# Vault Context\n\n";

		// Active file section
		if (context.activeFile) {
			formatted += `## Active File: ${context.activeFile.name}\n`;
			formatted += `Path: \`${context.activeFile.path}\`\n\n`;
			formatted += "```\n";
			formatted += context.activeFile.content;
			formatted += "\n```\n\n";
		}

		// Selected text section
		if (context.selectedText) {
			formatted += "## Selected Text\n\n";
			formatted += "```\n";
			formatted += context.selectedText;
			formatted += "\n```\n\n";
		}

		// Additional files section
		if (context.additionalFiles.length > 0) {
			formatted += "## Additional Files\n\n";
			for (const file of context.additionalFiles) {
				formatted += `### ${file.name}\n`;
				formatted += `Path: \`${file.path}\`\n\n`;
				formatted += "```\n";
				formatted += file.content;
				formatted += "\n```\n\n";
			}
		}

		return formatted;
	}

	/**
	 * Truncate context to fit within token budget
	 * Rough estimation: 1 token ≈ 4 characters
	 */
	truncateToTokenLimit(
		contextString: string,
		maxTokens: number
	): string {
		const maxChars = maxTokens * 4;
		
		if (contextString.length <= maxChars) {
			return contextString;
		}

		// Truncate and add notice
		const truncated = contextString.substring(0, maxChars);
		const lastNewline = truncated.lastIndexOf("\n");
		const finalText = lastNewline > 0 ? truncated.substring(0, lastNewline) : truncated;
		
		return finalText + "\n\n[... Context truncated due to token limit ...]";
	}

	/**
	 * Build and format context with token limit
	 */
	async buildFormattedContext(
		settings: ContextSettings,
		maxTokensForContext: number
	): Promise<string | null> {
		const context = await this.buildContext(settings);
		
		if (!context) {
			return null;
		}

		const formatted = this.formatStructuredContext(context);
		const truncated = this.truncateToTokenLimit(formatted, maxTokensForContext);
		
		return truncated;
	}

	/**
	 * Calculate max tokens for context based on percentage
	 */
	calculateContextTokenBudget(
		totalMaxTokens: number,
		contextPercent: number
	): number {
		return Math.floor((totalMaxTokens * contextPercent) / 100);
	}
}
