import { App } from "obsidian";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { editFile } from "mcp/vaultOps";
import { fromVaultOpResult, errorResult } from "mcp/toolResult";
import { requestMcpApproval } from "mcp/McpPermissionModal";

export function registerEditFileTool(server: McpServer, app: App): void {
	server.registerTool(
		"edit_file",
		{
			description: "Replace the full contents of an existing note in the vault.",
			inputSchema: {
				path: z.string().describe("Vault-relative path to the note to modify."),
				content: z.string().describe("New contents that will replace the note's existing contents."),
			},
		},
		async ({ path, content }) => {
			const approved = await requestMcpApproval(
				app,
				"edit_file",
				`Overwrite the contents of "${path}"?`,
				{ path, content }
			);
			if (!approved) return errorResult(`Denied by user: edit_file ${path}`);

			const op = await editFile(app, path, content);
			return fromVaultOpResult(op, (result) => result);
		}
	);
}
