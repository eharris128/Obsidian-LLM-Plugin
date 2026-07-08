/**
 * Generates a bearer token using Web Crypto (available in the Electron renderer on both
 * desktop and mobile) — deliberately avoids Node's `crypto` module so this can be imported
 * eagerly from the settings UI without pulling in any desktop-only dependency chain.
 */
export function generateMcpToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
