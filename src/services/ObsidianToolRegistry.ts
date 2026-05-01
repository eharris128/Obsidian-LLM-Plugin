import { App, TFile } from "obsidian";
import { RiskTier } from "Types/types";

export interface NeutralToolDefinition {
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, { type: string; description: string; enum?: string[] }>;
		required?: string[];
	};
	risk: RiskTier;
}

export type ToolResult = { success: boolean; result?: string; error?: string };

export class ObsidianToolRegistry {
	private tools: NeutralToolDefinition[] = [
		{
			name: "obsidian_create_note",
			description: "Create a new note in the vault with the given path and content.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "File path relative to vault root, e.g. 'Notes/meeting.md'. Must end in .md." },
					content: { type: "string", description: "Markdown content to write into the note." },
				},
				required: ["path", "content"],
			},
			risk: "write",
		},
		{
			name: "obsidian_read_note",
			description: "Read and return the full content of an existing note.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "File path relative to vault root." },
				},
				required: ["path"],
			},
			risk: "safe",
		},
		{
			name: "obsidian_modify_note",
			description: "Overwrite the entire content of an existing note.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "File path relative to vault root." },
					content: { type: "string", description: "New markdown content to write." },
				},
				required: ["path", "content"],
			},
			risk: "write",
		},
		{
			name: "obsidian_append_note",
			description: "Append text to the end of an existing note without overwriting it.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "File path relative to vault root." },
					content: { type: "string", description: "Text to append." },
				},
				required: ["path", "content"],
			},
			risk: "write",
		},
		{
			name: "obsidian_search",
			description: "Search for notes in the vault by filename. Returns matching file paths.",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: "Search string matched against file names." },
				},
				required: ["query"],
			},
			risk: "safe",
		},
		{
			name: "obsidian_list_notes",
			description: "List all markdown files in the vault, optionally filtered to a subfolder.",
			parameters: {
				type: "object",
				properties: {
					folder: { type: "string", description: "Optional folder path to restrict the listing (e.g. 'Projects')." },
				},
			},
			risk: "safe",
		},
		{
			name: "obsidian_open_note",
			description: "Open a note in the Obsidian workspace so the user can see it.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "File path relative to vault root." },
				},
				required: ["path"],
			},
			risk: "write",
		},
		{
			name: "obsidian_execute_command",
			description: "Execute a built-in Obsidian command by its ID (e.g. 'editor:toggle-bold', 'global-search:open', 'daily-notes').",
			parameters: {
				type: "object",
				properties: {
					command_id: { type: "string", description: "The Obsidian command ID to execute." },
				},
				required: ["command_id"],
			},
			risk: "danger",
		},
	];

	constructor(private app: App) {}

	getTools(): NeutralToolDefinition[] {
		return this.tools;
	}

	getRisk(toolName: string): RiskTier {
		return this.tools.find(t => t.name === toolName)?.risk ?? "danger";
	}

	getDescription(toolName: string): string {
		return this.tools.find(t => t.name === toolName)?.description ?? toolName;
	}

	async executeTool(name: string, input: Record<string, any>): Promise<ToolResult> {
		try {
			switch (name) {
				case "obsidian_create_note": {
					const { path, content } = input as { path: string; content: string };
					// Create intermediate folders if needed
					const folder = path.substring(0, path.lastIndexOf("/"));
					if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
						await this.app.vault.createFolder(folder);
					}
					await this.app.vault.create(path, content);
					return { success: true, result: `Created note at ${path}` };
				}

				case "obsidian_read_note": {
					const { path } = input as { path: string };
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };
					const content = await this.app.vault.read(file);
					return { success: true, result: content };
				}

				case "obsidian_modify_note": {
					const { path, content } = input as { path: string; content: string };
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };
					await this.app.vault.modify(file, content);
					return { success: true, result: `Modified ${path}` };
				}

				case "obsidian_append_note": {
					const { path, content } = input as { path: string; content: string };
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };
					const existing = await this.app.vault.read(file);
					await this.app.vault.modify(file, existing + "\n" + content);
					return { success: true, result: `Appended to ${path}` };
				}

				case "obsidian_search": {
					const { query } = input as { query: string };
					const q = query.toLowerCase();
					const results = this.app.vault
						.getMarkdownFiles()
						.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
						.map(f => f.path)
						.slice(0, 20);
					return {
						success: true,
						result: results.length > 0 ? results.join("\n") : "No matching files found.",
					};
				}

				case "obsidian_list_notes": {
					const { folder } = input as { folder?: string };
					const files = this.app.vault
						.getMarkdownFiles()
						.filter(f => !folder || f.path.startsWith(folder))
						.map(f => f.path);
					return {
						success: true,
						result: files.length > 0 ? files.join("\n") : "No files found.",
					};
				}

				case "obsidian_open_note": {
					const { path } = input as { path: string };
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };
					await this.app.workspace.getLeaf(false).openFile(file);
					return { success: true, result: `Opened ${path}` };
				}

				case "obsidian_execute_command": {
					const { command_id } = input as { command_id: string };
					const success = (this.app as any).commands.executeCommandById(command_id);
					return success
						? { success: true, result: `Executed command: ${command_id}` }
						: { success: false, error: `Command not found or failed: ${command_id}` };
				}

				default:
					return { success: false, error: `Unknown tool: ${name}` };
			}
		} catch (e: any) {
			return { success: false, error: e?.message ?? String(e) };
		}
	}
}
