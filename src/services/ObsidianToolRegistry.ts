import { App, TFile } from "obsidian";
import { RiskTier } from "Types/types";
import { VaultIndexer } from "RAG/VaultIndexer";

export interface NeutralToolDefinition {
	name: string;
	/** Short human-readable label shown in the Settings → Tools list. */
	displayName: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, { type: string; description: string; enum?: string[] }>;
		required?: string[];
	};
	risk: RiskTier;
	/** When true, a note is shown in Settings that this tool requires Vault Search (RAG). */
	requiresRag?: boolean;
}

export type ToolResult = { success: boolean; result?: string; error?: string };

/** Canonical list of all available tools. Exported so Settings can render the tool list. */
export const ALL_TOOL_DEFINITIONS: NeutralToolDefinition[] = [
	{
		name: "obsidian_create_note",
		displayName: "Create note",
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
		displayName: "Read note",
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
		displayName: "Modify note",
		description: "Overwrite the ENTIRE content of an existing note. WARNING: this replaces every byte of the file. You MUST call obsidian_read_note first and include the complete existing content with your changes merged in. Use obsidian_update_frontmatter instead when you only need to change frontmatter properties.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "File path relative to vault root." },
				content: { type: "string", description: "Complete new markdown content to write (must include all existing content with your edits applied)." },
			},
			required: ["path", "content"],
		},
		risk: "write",
	},
	{
		name: "obsidian_update_frontmatter",
		displayName: "Update frontmatter",
		description: "Safely update one or more frontmatter properties in an existing note without touching the note body. Pass the properties to add or change as a JSON object string. Example updates_json: '{\"status\": \"Done\", \"priority\": \"high\"}'.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "File path relative to vault root." },
				updates_json: { type: "string", description: "JSON object string of frontmatter key-value pairs to set. Example: '{\"status\": \"In Progress\", \"tags\": [\"project\", \"active\"]}'." },
			},
			required: ["path", "updates_json"],
		},
		risk: "write",
	},
	{
		name: "obsidian_append_note",
		displayName: "Append to note",
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
		displayName: "Search notes",
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
		displayName: "List notes",
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
		displayName: "Open note",
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
		displayName: "Execute command",
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
	{
		name: "search_vault_semantic",
		displayName: "Semantic vault search",
		description: "Semantically search the vault using vector similarity. Returns the most relevant note excerpts for a natural-language query.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Natural language search query describing what to look for in the vault." },
				limit: { type: "string", description: "Number of results to return (1–10, default 5)." },
			},
			required: ["query"],
		},
		risk: "safe",
		requiresRag: true,
	},
	{
		name: "grep_vault",
		displayName: "Grep vault",
		description: "Search all notes for lines matching a text pattern or regex. Returns file paths, line numbers, and surrounding context.",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Text or regular expression to search for across all notes. Examples: 'https?://' to find external links, 'TODO' to find todos, '\\[\\[' to find internal links." },
				folder: { type: "string", description: "Optional vault-root folder path to restrict the search (e.g. 'Projects'). Leave empty to search all notes." },
				context_lines: { type: "string", description: "Number of surrounding lines to include with each match for context (0–5, default 1)." },
				max_results: { type: "string", description: "Maximum number of matching lines to return (1–200, default 50)." },
			},
			required: ["pattern"],
		},
		risk: "safe",
	},
];

export class ObsidianToolRegistry {
	private tools: NeutralToolDefinition[] = ALL_TOOL_DEFINITIONS;
	/** Dynamic tools registered at runtime (e.g. invoke_assistant in agent mode). */
	private dynamicTools: Map<string, { def: NeutralToolDefinition; executor: (input: any) => Promise<ToolResult> }> = new Map();

	constructor(private app: App, private vaultIndexer?: VaultIndexer) {}

	/**
	 * Register a tool that isn't in ALL_TOOL_DEFINITIONS.
	 * Used by ObsidianAgent to add `invoke_assistant` at agent-mode start.
	 */
	registerDynamicTool(
		def: NeutralToolDefinition,
		executor: (input: any) => Promise<ToolResult>
	): void {
		this.dynamicTools.set(def.name, { def, executor });
	}

	getTools(): NeutralToolDefinition[] {
		const dynamic = Array.from(this.dynamicTools.values()).map((d) => d.def);
		return [...this.tools, ...dynamic];
	}

	getRisk(toolName: string): RiskTier {
		if (this.dynamicTools.has(toolName)) return this.dynamicTools.get(toolName)!.def.risk;
		return this.tools.find(t => t.name === toolName)?.risk ?? "danger";
	}

	getDescription(toolName: string): string {
		if (this.dynamicTools.has(toolName)) return this.dynamicTools.get(toolName)!.def.description;
		return this.tools.find(t => t.name === toolName)?.description ?? toolName;
	}

	async executeTool(name: string, input: Record<string, any>): Promise<ToolResult> {
		// Dynamic tools (registered at runtime) take priority
		if (this.dynamicTools.has(name)) {
			try {
				return await this.dynamicTools.get(name)!.executor(input);
			} catch (e) {
				return { success: false, error: String(e) };
			}
		}

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

				case "obsidian_update_frontmatter": {
					const { path, updates_json } = input as { path: string; updates_json: string };
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };
					let updates: Record<string, any>;
					try {
						updates = JSON.parse(updates_json);
						if (typeof updates !== "object" || Array.isArray(updates) || updates === null) {
							return { success: false, error: "updates_json must be a JSON object (e.g. {\"key\": \"value\"})" };
						}
					} catch {
						return { success: false, error: `Invalid JSON in updates_json: ${updates_json}` };
					}
					await this.app.fileManager.processFrontMatter(file, (fm) => {
						for (const [key, value] of Object.entries(updates)) {
							fm[key] = value;
						}
					});
					const keys = Object.keys(updates).join(", ");
					const displayName = path.replace(/\.md$/, "");
					return { success: true, result: `Updated frontmatter keys [${keys}] in [[${displayName}]]` };
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

				case "search_vault_semantic": {
					if (!this.vaultIndexer) {
						return { success: false, error: "Vault search is not configured. Enable RAG in plugin settings and index your vault first." };
					}
					const { query, limit } = input as { query: string; limit?: string };
					const topK = Math.min(10, Math.max(1, parseInt(limit ?? "5", 10) || 5));
					const result = await this.vaultIndexer.semanticSearch(query, topK);
					return { success: true, result };
				}

				case "grep_vault": {
					const {
						pattern,
						folder,
						context_lines: ctxArg,
						max_results: maxArg,
					} = input as { pattern: string; folder?: string; context_lines?: string; max_results?: string };

					const ctxLines = Math.min(5, Math.max(0, parseInt(ctxArg ?? "1", 10) || 1));
					const maxResults = Math.min(200, Math.max(1, parseInt(maxArg ?? "50", 10) || 50));

					let regex: RegExp;
					try {
						regex = new RegExp(pattern, "i");
					} catch {
						return { success: false, error: `Invalid regex pattern: ${pattern}` };
					}

					const files = this.app.vault
						.getMarkdownFiles()
						.filter(f => !folder || f.path.startsWith(folder.endsWith("/") ? folder : folder + "/"));

					const matches: string[] = [];

					for (const file of files) {
						if (matches.length >= maxResults) break;
						let content: string;
						try {
							content = await this.app.vault.read(file);
						} catch {
							continue;
						}
						const lines = content.split("\n");
						for (let i = 0; i < lines.length; i++) {
							if (matches.length >= maxResults) break;
							if (regex.test(lines[i])) {
								const start = Math.max(0, i - ctxLines);
								const end = Math.min(lines.length - 1, i + ctxLines);
								const excerpt = lines.slice(start, end + 1).join("\n");
								matches.push(`${file.path} (line ${i + 1}):\n${excerpt}`);
							}
						}
					}

					if (matches.length === 0) {
						return { success: true, result: `No matches found for pattern: ${pattern}` };
					}

					const header = `Found ${matches.length} match${matches.length === 1 ? "" : "es"} for "${pattern}":\n\n`;
					return { success: true, result: header + matches.join("\n\n---\n\n") };
				}

				default:
					return { success: false, error: `Unknown tool: ${name}` };
			}
		} catch (e: any) {
			return { success: false, error: e?.message ?? String(e) };
		}
	}
}
