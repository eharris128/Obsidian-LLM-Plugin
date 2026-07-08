import { App, Platform } from "obsidian";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "mcp/server";
import { logger } from "utils/logger";

// Type-only references — erased at build time, no runtime import. The
// runtime module is required lazily inside the functions that need it (see
// start()/safeCompare()) since this whole file is only ever dynamically
// imported from main.ts behind a Platform.isDesktop check.
type HttpIncomingMessage = import("http").IncomingMessage;
type HttpServerResponse = import("http").ServerResponse;
type HttpServer = import("http").Server;

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function sendJsonRpcError(res: HttpServerResponse, status: number, message: string): void {
	if (res.headersSent) return;
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function hasValidHost(req: HttpIncomingMessage): boolean {
	const hostHeader = req.headers.host;
	if (!hostHeader) return false;
	try {
		const hostname = new URL(`http://${hostHeader}`).hostname;
		return ALLOWED_HOSTNAMES.has(hostname);
	} catch {
		return false;
	}
}

function safeCompare(a: string, b: string): boolean {
	if (!Platform.isDesktop) return false;
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node builtin; guarded by the Platform.isDesktop check above
	const { timingSafeEqual } = require("crypto") as typeof import("crypto");
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

function hasValidAuth(req: HttpIncomingMessage, token: string): boolean {
	const header = req.headers["authorization"];
	if (typeof header !== "string") return false;
	const match = /^Bearer (.+)$/.exec(header);
	if (!match) return false;
	return safeCompare(match[1], token);
}

function readJsonBody(req: HttpIncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let data = "";
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error("Payload too large"));
				req.destroy();
				return;
			}
			data += chunk.toString("utf8");
		});
		req.on("end", () => {
			if (!data) return resolve(undefined);
			try {
				resolve(JSON.parse(data));
			} catch (e) {
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		});
		req.on("error", reject);
	});
}

/**
 * In-process Streamable HTTP MCP server, bound to 127.0.0.1 only.
 * Runs in stateless mode (a fresh McpServer + transport per request) — this
 * plugin serves a single local user, so per-session state isn't worth the
 * complexity, and it matches the SDK's own documented stateless example.
 */
export class McpTransportServer {
	private httpServer: HttpServer | null = null;

	constructor(
		private app: App,
		private getToken: () => string,
		private version: string
	) {}

	start(port: number): Promise<void> {
		if (!Platform.isDesktop) return Promise.reject(new Error("MCP server requires Obsidian Desktop."));
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node builtin; guarded by the Platform.isDesktop check above
		const http = require("http") as typeof import("http");
		return new Promise((resolve, reject) => {
			const server = http.createServer((req, res) => {
				this.handleRequest(req, res).catch((e) => {
					logger.error("[MCP] Request handling failed:", e);
					sendJsonRpcError(res, 500, "Internal server error");
				});
			});
			server.once("error", reject);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", reject);
				server.on("error", (e) => logger.error("[MCP] Server error:", e));
				this.httpServer = server;
				resolve();
			});
		});
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.httpServer) return resolve();
			const server = this.httpServer;
			this.httpServer = null;
			server.close(() => resolve());
		});
	}

	private async handleRequest(req: HttpIncomingMessage, res: HttpServerResponse): Promise<void> {
		if (!hasValidHost(req)) return sendJsonRpcError(res, 403, "Invalid Host header");
		if (!hasValidAuth(req, this.getToken())) return sendJsonRpcError(res, 401, "Unauthorized");

		const url = req.url ?? "";
		const path = url.split("?")[0];
		if (path !== "/mcp") return sendJsonRpcError(res, 404, "Not found");

		if (req.method === "GET" || req.method === "DELETE") {
			return sendJsonRpcError(res, 405, "Method not allowed. This server only supports stateless POST requests.");
		}
		if (req.method !== "POST") {
			return sendJsonRpcError(res, 405, "Method not allowed.");
		}

		let body: unknown;
		try {
			body = await readJsonBody(req);
		} catch {
			return sendJsonRpcError(res, 400, "Invalid JSON body");
		}

		const server = createMcpServer(this.app, this.version);
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => {
			transport.close().catch((e) => logger.error("[MCP] Error closing transport:", e));
			server.close().catch((e) => logger.error("[MCP] Error closing server:", e));
		});
		await server.connect(transport);
		await transport.handleRequest(req, res, body);
	}
}
