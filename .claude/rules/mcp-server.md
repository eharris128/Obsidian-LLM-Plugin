---
paths:
  - "src/mcp/**"
---

# MCP Server

Built-in Streamable HTTP MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server (`mcpServerSettings.enabled`, gated behind `featureSettings.mcpServer`) so external clients (Claude Desktop, etc.) can read/write the vault directly. Separate from the agentic tool-use loop (`AgentLoop`/`ObsidianToolRegistry`) — this makes the plugin an MCP *server*, callable from outside Obsidian, not a client.

**Desktop-only, and every module in `src/mcp/` is loaded lazily**, following the Node/Electron access pattern above. `main.ts` only ever `import type`s `McpTransportServer` (erased at build time) and dynamically `await import("mcp/transport")` inside `initMcpServer()`, itself gated on `Platform.isDesktop && settings.mcpServerSettings.enabled`. This matters because `@modelcontextprotocol/sdk` pulls in `@hono/node-server` → `node:http` at module scope — a static top-level import anywhere reachable from `main.ts`'s eager load path would crash the whole plugin on mobile. Never convert the `mcp/transport` import to static.

`transport.ts`'s `start()` and `safeCompare()` each additionally lead with `if (!Platform.isDesktop) return/throw ...` before their own `require()` calls, satisfying `obsidianmd/no-nodejs-modules` structurally rather than by suppression (that rule can't be eslint-disabled). Type-only references to Node builtin types (e.g. `type HttpServer = import("http").Server;`) don't trigger the rule at all since there's no runtime import.

**Files**: `pathGuard.ts` (`guardVaultPath` — resolves/validates a vault-relative path against the vault root, rejecting `../` traversal including encoded/double-encoded and absolute/drive-letter forms; throws `PathTraversalError`), `vaultOps.ts` (shared list/read/search/create/edit/move/delete over `app.vault`/`app.fileManager`, returns `VaultOpResult` — never throws), `McpPermissionModal.ts` (`requestMcpApproval()` — see below), `server.ts` (`createMcpServer()` factory registering all 7 tools on a fresh `McpServer`), `transport.ts` (`McpTransportServer` — the raw `http.Server`, Host-header + bearer-token checks, stateless per-request `McpServer`+`StreamableHTTPServerTransport`), `token.ts` (`generateMcpToken()` — Web Crypto, not Node `crypto`, so it's safe to import eagerly from the settings UI), `tools/*.ts` (one file per tool, zod input schemas).

**Permission gate — not the same as the chat one.** `ChatContainer.showPermissionUI()` is a chat-history card tied to an open conversation; it doesn't exist for an MCP request, which can arrive with no chat window open. `McpPermissionModal` is a real `Modal` instead, used only by the 4 write tools (`create_file`, `edit_file`, `move_file`, `delete_file`); `list_files`/`read_file`/`search_vault` run immediately, no confirmation. Dismissing the modal without an explicit choice (Escape, backdrop click) resolves to deny — there's no "no decision" state.

**Transport is stateless** — a fresh `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per HTTP request, matching the SDK's own documented stateless-server example. No session tracking; fine for a single local user, avoids dangling-session cleanup.

**Auth**: `Authorization: Bearer <token>` checked via `crypto.timingSafeEqual` (length-checked first, so it isn't literally constant-time, but avoids leaking the token itself). Host header restricted to `localhost`/`127.0.0.1`/`::1` (DNS-rebinding protection) before any MCP logic runs. Both checks happen before the request body is even parsed.

**Settings UI**: `LLMSettingsModal.renderMcpServer()` — enable toggle, port field (restarts server via `plugin.initMcpServer()` on change), bearer token display + Copy/Regenerate (regenerate doesn't need a restart — `McpTransportServer`'s `getToken` is a live closure over `settings.mcpServerSettings.token`), and a `claude_desktop_config.json` snippet with a copy button. Gated in `navSections` via `featureGate: "mcpServer"`, same double-toggle pattern as Transcription/Memory (Features-section toggle and the tab's own toggle both flip `mcpServerSettings.enabled` + call `initMcpServer()`).

**Known client quirk**: some Claude Desktop builds (e.g. Cowork-flavored) only accept `command`/`args` (stdio launcher) config entries, not the newer `{ url, headers }` remote-server shape — bridge via [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (`npx -y mcp-remote <url> --header "Authorization: Bearer <token>"`) in that case.
