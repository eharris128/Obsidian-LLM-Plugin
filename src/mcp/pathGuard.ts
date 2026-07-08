/**
 * Resolves an MCP-supplied path against the vault root and rejects any attempt
 * to escape it — including encoded and double-encoded `../` traversal and
 * absolute/drive-letter paths. Obsidian vault paths are always POSIX-style and
 * relative to the vault root, so the checks below operate purely on the string
 * form (there is no filesystem call to bypass here).
 */
export class PathTraversalError extends Error {}

export function guardVaultPath(rawPath: string): string {
	if (typeof rawPath !== "string" || rawPath.length === 0) {
		throw new PathTraversalError("Path must be a non-empty string");
	}

	// Repeatedly percent-decode to catch double-encoded traversal (e.g. %252e%252e).
	let decoded = rawPath;
	for (let i = 0; i < 5; i++) {
		let next: string;
		try {
			next = decodeURIComponent(decoded);
		} catch {
			break;
		}
		if (next === decoded) break;
		decoded = next;
	}

	if (decoded.includes("\0")) {
		throw new PathTraversalError("Path contains a null byte");
	}

	const normalized = decoded.replace(/\\/g, "/");
	if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
		throw new PathTraversalError(`Absolute paths are not allowed: ${rawPath}`);
	}

	const segments = normalized.split("/");
	const resolved: string[] = [];
	for (const segment of segments) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (resolved.length === 0) {
				throw new PathTraversalError(`Path escapes the vault root: ${rawPath}`);
			}
			resolved.pop();
			continue;
		}
		resolved.push(segment);
	}

	if (resolved.length === 0) {
		throw new PathTraversalError(`Path resolves to the vault root: ${rawPath}`);
	}

	return resolved.join("/");
}
