import { App } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListFilesTool } from "mcp/tools/listFiles";
import { registerReadFileTool } from "mcp/tools/readFile";
import { registerSearchVaultTool } from "mcp/tools/searchVault";
import { registerCreateFileTool } from "mcp/tools/createFile";
import { registerEditFileTool } from "mcp/tools/editFile";
import { registerMoveFileTool } from "mcp/tools/moveFile";
import { registerDeleteFileTool } from "mcp/tools/deleteFile";

/** Builds a fresh McpServer instance with all vault tools registered. One is created per request (see transport.ts) — cheap, and matches the SDK's stateless-server reference pattern. */
export function createMcpServer(app: App, version: string): McpServer {
	const server = new McpServer({ name: "obsidian-vault", version });

	registerListFilesTool(server, app);
	registerReadFileTool(server, app);
	registerSearchVaultTool(server, app);
	registerCreateFileTool(server, app);
	registerEditFileTool(server, app);
	registerMoveFileTool(server, app);
	registerDeleteFileTool(server, app);

	return server;
}
