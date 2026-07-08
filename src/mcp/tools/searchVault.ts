import { App } from "obsidian";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchVault } from "mcp/vaultOps";
import { fromVaultOpResult } from "mcp/toolResult";

export function registerSearchVaultTool(server: McpServer, app: App): void {
	server.registerTool(
		"search_vault",
		{
			description: "Case-insensitive text search across markdown notes in the vault. Returns matching file paths, line numbers, and excerpts.",
			inputSchema: {
				query: z.string().describe("Text to search for."),
				folder: z.string().optional().describe("Vault-relative folder path to scope the search to. Omit to search the whole vault."),
			},
		},
		async ({ query, folder }) => {
			const op = await searchVault(app, query, folder);
			return fromVaultOpResult(op, (matches) => {
				if (matches.length === 0) return `No matches found for "${query}".`;
				const lines = matches.map(m => `${m.path} (line ${m.line}): ${m.excerpt}`);
				return `Found ${matches.length} match${matches.length === 1 ? "" : "es"}:\n\n${lines.join("\n")}`;
			});
		}
	);
}
