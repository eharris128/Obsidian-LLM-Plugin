import { App } from "obsidian";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFile } from "mcp/vaultOps";
import { fromVaultOpResult, errorResult } from "mcp/toolResult";
import { requestMcpApproval } from "mcp/McpPermissionModal";

export function registerCreateFileTool(server: McpServer, app: App): void {
	server.registerTool(
		"create_file",
		{
			description: "Create a new note in the vault. Fails if a file already exists at the given path.",
			inputSchema: {
				path: z.string().describe("Vault-relative path for the new note, e.g. \"Folder/Note.md\"."),
				content: z.string().describe("Initial contents of the note."),
			},
		},
		async ({ path, content }) => {
			const approved = await requestMcpApproval(
				app,
				"create_file",
				`Create a new note at "${path}"?`,
				{ path, content }
			);
			if (!approved) return errorResult(`Denied by user: create_file ${path}`);

			const op = await createFile(app, path, content);
			return fromVaultOpResult(op, (result) => result);
		}
	);
}
