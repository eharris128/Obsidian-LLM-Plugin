import { App } from "obsidian";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deleteFile } from "mcp/vaultOps";
import { fromVaultOpResult, errorResult } from "mcp/toolResult";
import { requestMcpApproval } from "mcp/McpPermissionModal";

export function registerDeleteFileTool(server: McpServer, app: App): void {
	server.registerTool(
		"delete_file",
		{
			description: "Delete a note from the vault (moved to trash, following the user's Obsidian trash preference).",
			inputSchema: {
				path: z.string().describe("Vault-relative path of the note to delete."),
			},
		},
		async ({ path }) => {
			const approved = await requestMcpApproval(
				app,
				"delete_file",
				`Delete "${path}"?`,
				{ path }
			);
			if (!approved) return errorResult(`Denied by user: delete_file ${path}`);

			const op = await deleteFile(app, path);
			return fromVaultOpResult(op, (result) => result);
		}
	);
}
