import { App, TFile } from "obsidian";
import { RiskTier } from "Types/types";
import { VaultIndexer } from "RAG/VaultIndexer";
import { ChatHistory } from "services/ChatHistory";
import { SearxngService, SearxngHttpError } from "WebSearch/SearxngService";

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
	/** When true, a note is shown in Settings that this tool requires SearXNG to be configured. */
	requiresWebSearch?: boolean;
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
		description: "Append text to the very end of an existing note. Use obsidian_insert_after_heading instead when you need to add content inside a specific section.",
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
		name: "obsidian_insert_after_heading",
		displayName: "Insert after heading",
		description: "Insert text immediately after a specific heading in a note, without touching the rest of the file. Use this instead of obsidian_append_note whenever the user asks to add content to a named section (e.g. 'add a bullet to the Log section'). The heading match is case-insensitive and ignores the leading # characters.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "File path relative to vault root." },
				heading: { type: "string", description: "The heading text to insert after (e.g. 'Log' or 'Scheduled tasks'). Do not include # characters." },
				content: { type: "string", description: "Text to insert on a new line immediately after the heading line." },
			},
			required: ["path", "heading", "content"],
		},
		risk: "write",
	},
	{
		name: "obsidian_patch_note",
		displayName: "Patch note",
		description: "Find an exact string in a note and replace it with new text. Use for surgical edits — change a single line, fix a value, or update a specific phrase — without rewriting the whole file. The old_string must match exactly (including whitespace). Returns an error if the string is not found or appears more than once.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "File path relative to vault root." },
				old_string: { type: "string", description: "The exact text to find and replace. Must be unique within the file." },
				new_string: { type: "string", description: "The text to replace it with." },
			},
			required: ["path", "old_string", "new_string"],
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
	{
		name: "web_search",
		displayName: "Web search",
		description: "Search the web via a self-hosted SearXNG instance and return the top results as title, URL, and snippet. Use for current events, documentation, or any question that requires up-to-date information from outside the vault.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "The search query to look up." },
				num_results: { type: "string", description: "Number of results to return (1–10, default uses the configured maximum)." },
			},
			required: ["query"],
		},
		risk: "safe",
		requiresWebSearch: true,
	},
	{
		name: "get_chat_history",
		displayName: "Get chat history",
		description: "Access saved LLM conversations. Use action 'list' to get recent chats with metadata (title, date, model, project), or action 'load' to read the full message contents of a specific chat by file path.",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "load"],
					description: "'list' returns recent chats with metadata. 'load' reads the full conversation from a specific file path.",
				},
				path: {
					type: "string",
					description: "Required for 'load': the vault-relative file path of the chat to read (e.g. 'LLM Chats/my-chat.md').",
				},
				limit: {
					type: "string",
					description: "For 'list': maximum number of recent chats to return (1–50, default 20).",
				},
				filter_project: {
					type: "string",
					description: "For 'list': only return chats belonging to this project name.",
				},
				filter_agent: {
					type: "string",
					enum: ["true", "false"],
					description: "For 'list': filter to agent chats ('true') or non-agent chats ('false'). Omit to return all.",
				},
			},
			required: ["action"],
		},
		risk: "safe",
	},
];

export class ObsidianToolRegistry {
	private tools: NeutralToolDefinition[] = ALL_TOOL_DEFINITIONS;
	/** Dynamic tools registered at runtime (e.g. invoke_assistant in agent mode). */
	private dynamicTools: Map<string, { def: NeutralToolDefinition; executor: (input: any) => Promise<ToolResult> }> = new Map();

	constructor(
		private app: App,
		private vaultIndexer?: VaultIndexer,
		private chatHistory?: ChatHistory,
		private searxngService?: SearxngService | null,
	) {}

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

				case "obsidian_insert_after_heading": {
					const { path, heading, content } = input as { path: string; heading: string; content: string };
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };
					const existing = await this.app.vault.read(file);
					const lines = existing.split("\n");
					const headingNorm = heading.replace(/^#+\s*/, "").trim().toLowerCase();
					const headingIdx = lines.findIndex(l => l.replace(/^#+\s*/, "").trim().toLowerCase() === headingNorm);
					if (headingIdx === -1) {
						return { success: false, error: `Heading "${heading}" not found in ${path}` };
					}
					lines.splice(headingIdx + 1, 0, content);
					await this.app.vault.modify(file, lines.join("\n"));
					return { success: true, result: `Inserted content after heading "${heading}" in ${path}` };
				}

				case "obsidian_patch_note": {
					const { path, old_string, new_string } = input as { path: string; old_string: string; new_string: string };
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };
					const existing = await this.app.vault.read(file);
					// Count occurrences to ensure uniqueness
					let count = 0;
					let pos = 0;
					while ((pos = existing.indexOf(old_string, pos)) !== -1) { count++; pos += old_string.length; }
					if (count === 0) return { success: false, error: `String not found in ${path}: ${old_string}` };
					if (count > 1) return { success: false, error: `String appears ${count} times in ${path} — provide more surrounding context to make it unique` };
					await this.app.vault.modify(file, existing.replace(old_string, new_string));
					return { success: true, result: `Patched ${path}` };
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
								// Use wikilink format so filenames with spaces become fully clickable links.
								const wikiTarget = file.path.replace(/\.md$/, "");
								matches.push(`[[${wikiTarget}]] (line ${i + 1}):\n${excerpt}`);
							}
						}
					}

					if (matches.length === 0) {
						return { success: true, result: `No matches found for pattern: ${pattern}` };
					}

					const header = `Found ${matches.length} match${matches.length === 1 ? "" : "es"} for "${pattern}":\n\n`;
					return { success: true, result: header + matches.join("\n\n---\n\n") };
				}

				case "web_search": {
					if (!this.searxngService) {
						return {
							success: false,
							error:
								"Web search is not available. Enable SearXNG in Settings → Obsidian Agent → Web Search and ensure the host is reachable.",
						};
					}
					const { query, num_results } = input as { query: string; num_results?: string };
					const numResults = num_results ? Math.min(10, Math.max(1, parseInt(num_results, 10) || 5)) : undefined;
					try {
						const results = await this.searxngService.search(query, numResults);
						return { success: true, result: SearxngService.formatResults(results) };
					} catch (e: any) {
						// Surface the descriptive error message to the model so it can
						// explain the situation to the user (e.g. 429 rate limit).
						return { success: false, error: e?.message ?? String(e) };
					}
				}

				case "get_chat_history": {
					if (!this.chatHistory) {
						return { success: false, error: "Chat history is not available." };
					}
					const { action, path, limit, filter_project, filter_agent } = input as {
						action: "list" | "load";
						path?: string;
						limit?: string;
						filter_project?: string;
						filter_agent?: string;
					};

					if (action === "load") {
						if (!path) return { success: false, error: "action 'load' requires a 'path' parameter." };
						const loaded = await this.chatHistory.load(path);
						const { meta, messages } = loaded;
						const lines: string[] = [
							`# ${meta.title}`,
							`- **File**: ${path}`,
							`- **Created**: ${meta.created}`,
							`- **Updated**: ${meta.updated}`,
							`- **Model**: ${meta.model} (${meta.provider})`,
							...(meta.project ? [`- **Project**: ${meta.project}`] : []),
							...(meta.agent ? [`- **Agent chat**: yes`] : []),
							"",
							"## Conversation",
							"",
						];
						for (const msg of messages) {
							if (msg.role === "system") continue;
							lines.push(`### ${msg.role === "user" ? "User" : "Assistant"}`);
							lines.push(msg.content);
							lines.push("");
						}
						return { success: true, result: lines.join("\n") };
					}

					if (action === "list") {
						const maxCount = Math.min(50, Math.max(1, parseInt(limit ?? "20", 10) || 20));
						let files = await this.chatHistory.list();

						// Apply optional filters using vault file metadata where possible
						if (filter_project || filter_agent !== undefined) {
							const filtered: typeof files = [];
							for (const f of files) {
								if (filtered.length >= maxCount * 3) break; // read ahead enough to fill quota after filters
								try {
									const content = await this.app.vault.read(f);
									const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
									if (!fmMatch) continue;
									const { parseYaml } = await import("obsidian");
									const meta = parseYaml(fmMatch[1]) as Record<string, any>;
									if (filter_project && meta.project !== filter_project) continue;
									if (filter_agent === "true" && !meta.agent) continue;
									if (filter_agent === "false" && meta.agent) continue;
									filtered.push(f);
								} catch { continue; }
							}
							files = filtered;
						}

						const slice = files.slice(0, maxCount);
						if (slice.length === 0) {
							return { success: true, result: "No chat history found matching the given filters." };
						}

						const lines: string[] = [`Found ${slice.length} chat${slice.length === 1 ? "" : "s"}:\n`];
						for (const f of slice) {
							// Use stat mtime for date without reading file content
							const date = new Date(f.stat.mtime).toLocaleDateString();
							lines.push(`- **${f.basename}** (${date}) — \`${f.path}\``);
						}
						lines.push("\nUse action 'load' with the file path to read a full conversation.");
						return { success: true, result: lines.join("\n") };
					}

					return { success: false, error: `Unknown action: ${action}. Use 'list' or 'load'.` };
				}

				default:
					return { success: false, error: `Unknown tool: ${name}` };
			}
		} catch (e: any) {
			return { success: false, error: e?.message ?? String(e) };
		}
	}
}
