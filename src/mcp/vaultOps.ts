import { App, TFile } from "obsidian";
import { guardVaultPath } from "mcp/pathGuard";

export type VaultOpResult<T = string> =
	| { success: true; result: T }
	| { success: false; error: string };

const MAX_SEARCH_RESULTS = 50;

function errMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function withPrefix(path: string): string {
	return path.endsWith("/") ? path : path + "/";
}

export async function listFiles(app: App, folder?: string): Promise<VaultOpResult<string[]>> {
	let prefix: string | undefined;
	try {
		if (folder) prefix = withPrefix(guardVaultPath(folder));
	} catch (e) {
		return { success: false, error: errMessage(e) };
	}

	const files = app.vault
		.getFiles()
		.map(f => f.path)
		.filter(p => !prefix || p.startsWith(prefix))
		.sort();

	return { success: true, result: files };
}

export async function readFile(app: App, path: string): Promise<VaultOpResult<string>> {
	let guardedPath: string;
	try {
		guardedPath = guardVaultPath(path);
	} catch (e) {
		return { success: false, error: errMessage(e) };
	}

	const file = app.vault.getAbstractFileByPath(guardedPath);
	if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };

	try {
		const content = await app.vault.read(file);
		return { success: true, result: content };
	} catch (e) {
		return { success: false, error: `Failed to read ${path}: ${errMessage(e)}` };
	}
}

export type SearchMatch = { path: string; line: number; excerpt: string };

export async function searchVault(app: App, query: string, folder?: string): Promise<VaultOpResult<SearchMatch[]>> {
	if (!query.trim()) return { success: false, error: "Query must not be empty" };

	let prefix: string | undefined;
	try {
		if (folder) prefix = withPrefix(guardVaultPath(folder));
	} catch (e) {
		return { success: false, error: errMessage(e) };
	}

	const q = query.toLowerCase();
	const matches: SearchMatch[] = [];
	const files = app.vault.getMarkdownFiles().filter(f => !prefix || f.path.startsWith(prefix));

	for (const file of files) {
		if (matches.length >= MAX_SEARCH_RESULTS) break;
		let content: string;
		try {
			content = await app.vault.read(file);
		} catch {
			continue;
		}
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (matches.length >= MAX_SEARCH_RESULTS) break;
			if (lines[i].toLowerCase().includes(q)) {
				matches.push({ path: file.path, line: i + 1, excerpt: lines[i].trim() });
			}
		}
	}

	return { success: true, result: matches };
}

export async function createFile(app: App, path: string, content: string): Promise<VaultOpResult<string>> {
	let target: string;
	try {
		target = guardVaultPath(path);
	} catch (e) {
		return { success: false, error: errMessage(e) };
	}

	if (app.vault.getAbstractFileByPath(target)) {
		return { success: false, error: `A file already exists at ${path}` };
	}

	try {
		const folder = target.substring(0, target.lastIndexOf("/"));
		if (folder && !app.vault.getAbstractFileByPath(folder)) {
			await app.vault.createFolder(folder);
		}
		await app.vault.create(target, content);
		return { success: true, result: `Created ${target}` };
	} catch (e) {
		return { success: false, error: `Failed to create ${path}: ${errMessage(e)}` };
	}
}

export async function editFile(app: App, path: string, content: string): Promise<VaultOpResult<string>> {
	let guardedPath: string;
	try {
		guardedPath = guardVaultPath(path);
	} catch (e) {
		return { success: false, error: errMessage(e) };
	}

	const file = app.vault.getAbstractFileByPath(guardedPath);
	if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };

	try {
		await app.vault.modify(file, content);
		return { success: true, result: `Updated ${path}` };
	} catch (e) {
		return { success: false, error: `Failed to edit ${path}: ${errMessage(e)}` };
	}
}

export async function moveFile(app: App, path: string, newPath: string): Promise<VaultOpResult<string>> {
	let guardedSrc: string;
	let guardedDest: string;
	try {
		guardedSrc = guardVaultPath(path);
		guardedDest = guardVaultPath(newPath);
	} catch (e) {
		return { success: false, error: errMessage(e) };
	}

	const file = app.vault.getAbstractFileByPath(guardedSrc);
	if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };
	if (app.vault.getAbstractFileByPath(guardedDest)) {
		return { success: false, error: `A file already exists at ${newPath}` };
	}

	try {
		await app.fileManager.renameFile(file, guardedDest);
		return { success: true, result: `Moved ${path} to ${newPath}` };
	} catch (e) {
		return { success: false, error: `Failed to move ${path}: ${errMessage(e)}` };
	}
}

export async function deleteFile(app: App, path: string): Promise<VaultOpResult<string>> {
	let guardedPath: string;
	try {
		guardedPath = guardVaultPath(path);
	} catch (e) {
		return { success: false, error: errMessage(e) };
	}

	const file = app.vault.getAbstractFileByPath(guardedPath);
	if (!(file instanceof TFile)) return { success: false, error: `File not found: ${path}` };

	try {
		await app.fileManager.trashFile(file);
		return { success: true, result: `Deleted ${path}` };
	} catch (e) {
		return { success: false, error: `Failed to delete ${path}: ${errMessage(e)}` };
	}
}
