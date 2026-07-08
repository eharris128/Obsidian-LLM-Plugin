import { App } from "obsidian";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "mcp/vaultOps";
import { fromVaultOpResult } from "mcp/toolResult";

export function registerReadFileTool(server: McpServer, app: App): void {
	server.registerTool(
		"read_file",
		{
			description: "Return the contents of a note in the vault.",
			inputSchema: {
				path: z.string().describe("Vault-relative path to the note, e.g. \"Folder/Note.md\"."),
			},
		},
		async ({ path }) => {
			const op = await readFile(app, path);
			return fromVaultOpResult(op, (content) => content);
		}
	);
}
