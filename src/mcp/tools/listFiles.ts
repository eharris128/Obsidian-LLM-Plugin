import { App } from "obsidian";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listFiles } from "mcp/vaultOps";
import { fromVaultOpResult } from "mcp/toolResult";

export function registerListFilesTool(server: McpServer, app: App): void {
	server.registerTool(
		"list_files",
		{
			description: "List files in the vault, optionally scoped to a folder.",
			inputSchema: {
				folder: z.string().optional().describe("Vault-relative folder path to scope the listing to. Omit to list the whole vault."),
			},
		},
		async ({ folder }) => {
			const op = await listFiles(app, folder);
			return fromVaultOpResult(op, (files) => (files.length > 0 ? files.join("\n") : "No files found."));
		}
	);
}
