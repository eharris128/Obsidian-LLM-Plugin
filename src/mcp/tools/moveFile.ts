import { App } from "obsidian";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { moveFile } from "mcp/vaultOps";
import { fromVaultOpResult, errorResult } from "mcp/toolResult";
import { requestMcpApproval } from "mcp/McpPermissionModal";

export function registerMoveFileTool(server: McpServer, app: App): void {
	server.registerTool(
		"move_file",
		{
			description: "Rename or move a note to a new vault-relative path. Fails if a file already exists at the destination.",
			inputSchema: {
				path: z.string().describe("Vault-relative path of the note to move."),
				new_path: z.string().describe("New vault-relative path for the note."),
			},
		},
		async ({ path, new_path }) => {
			const approved = await requestMcpApproval(
				app,
				"move_file",
				`Move "${path}" to "${new_path}"?`,
				{ path, new_path }
			);
			if (!approved) return errorResult(`Denied by user: move_file ${path} -> ${new_path}`);

			const op = await moveFile(app, path, new_path);
			return fromVaultOpResult(op, (result) => result);
		}
	);
}
