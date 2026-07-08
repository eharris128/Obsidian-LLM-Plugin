import { VaultOpResult } from "mcp/vaultOps";

export type McpToolResult = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

export function textResult(text: string): McpToolResult {
	return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): McpToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

export function fromVaultOpResult<T>(op: VaultOpResult<T>, formatSuccess: (result: T) => string): McpToolResult {
	if (!op.success) return errorResult(op.error);
	return textResult(formatSuccess(op.result));
}
