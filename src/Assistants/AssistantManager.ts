/**
 * AssistantManager — discovers, parses, and hot-reloads ASSISTANT.md files from
 * the AI/Assistants/ folder inside the user's vault.
 *
 * Each assistant lives at: <rootVaultFolder>/Assistants/<assistant-id>/ASSISTANT.md
 *
 * NOTE: We use `vault.adapter` for all file I/O (same pattern as SkillRegistry /
 * ProjectManager) because Obsidian does not always index plugin-adjacent or
 * non-standard folders into its TFile cache.
 *
 * ASSISTANT.md format:
 * ---
 * name: My Assistant
 * description: One-line description
 * provider: claude                   # informational — UI can use for badge
 * model: claude-sonnet-4-6           # informational — future: auto-switch model
 * enabled-skills:                    # skill ids from AI/Skills/
 *   - summarize
 *   - create-note
 * allowed-tools:                     # ObsidianToolRegistry tool names
 *   - obsidian_read_note
 *   - obsidian_search
 * created: 2024-01-01T00:00:00.000Z
 * ---
 *
 * The body (below the frontmatter) is the assistant's system prompt, injected
 * as context when the assistant is active.
 */

import { App, TFile } from "obsidian";
import { logger } from "../utils/logger";
import { Assistant } from "Types/types";

export class AssistantManager {
	private assistants: Map<string, Assistant> = new Map();
	private assistantsFolder: string = "AI/Assistants";

	constructor(private app: App) {}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/** Return all discovered assistants. */
	getAssistants(): Assistant[] {
		return Array.from(this.assistants.values());
	}

	/** Look up an assistant by id (slug from folder name). */
	getAssistant(id: string | null | undefined): Assistant | null {
		if (!id) return null;
		return this.assistants.get(id) ?? null;
	}

	/** Find an assistant by display name (case-insensitive). Used by project default-assistant lookup. */
	getAssistantByName(name: string): Assistant | null {
		const lower = name.toLowerCase();
		for (const assistant of this.assistants.values()) {
			if (assistant.name.toLowerCase() === lower) return assistant;
		}
		return null;
	}

	/** Update the folder to watch and reload all assistants from it. */
	async setFolder(folder: string): Promise<void> {
		this.assistantsFolder = folder.replace(/\/$/, "");
		await this.reloadAll();
	}

	getFolder(): string {
		return this.assistantsFolder;
	}

	/**
	 * Scan the assistants folder via the vault adapter and parse every ASSISTANT.md found.
	 */
	async reloadAll(): Promise<void> {
		this.assistants.clear();
		const folderPath = this.assistantsFolder;

		let listing: { folders: string[]; files: string[] };
		try {
			listing = await this.app.vault.adapter.list(folderPath);
		} catch {
			// Folder doesn't exist yet — nothing to load
			return;
		}

		// Each assistant lives one level down: <assistantsFolder>/<assistant-id>/ASSISTANT.md
		for (const subFolder of listing.folders) {
			// Skip the memories sub-folder that MemoryService writes into
			const folderName = subFolder.split("/").pop() ?? "";
			if (folderName === "memories") continue;

			const candidates = [
				`${subFolder}/ASSISTANT.md`,
				`${subFolder}/ASSISTANT.md.md`,
			];
			for (const candidate of candidates) {
				const exists = await this.app.vault.adapter.exists(candidate);
				if (exists) {
					await this.loadAssistantByPath(candidate);
					break;
				}
			}
		}
	}

	/**
	 * Load and register an assistant from an arbitrary vault-relative path string.
	 */
	async loadAssistantByPath(filePath: string): Promise<void> {
		try {
			const exists = await this.app.vault.adapter.exists(filePath);
			if (!exists) return;
			const raw = await this.app.vault.adapter.read(filePath);
			const assistant = AssistantManager.parseAssistantFile(raw, filePath, this.assistantsFolder);
			if (assistant) {
				this.assistants.set(assistant.id, assistant);
				logger.log(`[AssistantManager] Loaded assistant: ${assistant.id} (${assistant.name})`);
			}
		} catch (e) {
			logger.error(`[AssistantManager] Failed to parse ${filePath}:`, e);
		}
	}

	/** Parse and register a single ASSISTANT.md TFile. */
	async loadAssistantFile(file: TFile): Promise<void> {
		await this.loadAssistantByPath(file.path);
	}

	/**
	 * Remove an assistant by file path (called when deleted or renamed out of folder).
	 */
	removeByPath(filePath: string): void {
		for (const [id, assistant] of this.assistants) {
			if (assistant.filePath === filePath) {
				this.assistants.delete(id);
				return;
			}
		}
	}

	/** True if the given vault path is an ASSISTANT.md inside the assistants folder. */
	isAssistantFile(path: string): boolean {
		return (
			path.startsWith(this.assistantsFolder + "/") &&
			(path.endsWith("/ASSISTANT.md") || path.endsWith("/ASSISTANT.md.md"))
		);
	}

	// ---------------------------------------------------------------------------
	// Create / delete helpers
	// ---------------------------------------------------------------------------

	/**
	 * Create a new assistant folder and a template ASSISTANT.md.
	 * Returns the vault path to the created ASSISTANT.md, or null on failure.
	 */
	async createAssistant(
		id: string,
		name: string,
		description: string,
		systemPrompt: string = ""
	): Promise<string | null> {
		const folderPath = `${this.assistantsFolder}/${id}`;
		const filePath = `${folderPath}/ASSISTANT.md`;

		// Ensure parent hierarchy exists
		const rootExists = await this.app.vault.adapter.exists(this.assistantsFolder);
		if (!rootExists) {
			await this.app.vault.adapter.mkdir(this.assistantsFolder);
		}

		const exists = await this.app.vault.adapter.exists(folderPath);
		if (!exists) {
			await this.app.vault.adapter.mkdir(folderPath);
		}

		const memoriesFolder = `${folderPath}/memories`;
		const memoriesExist = await this.app.vault.adapter.exists(memoriesFolder);
		if (!memoriesExist) {
			await this.app.vault.adapter.mkdir(memoriesFolder);
		}

		const created = new Date().toISOString();
		const content = `---
name: ${name}
description: ${description}
provider:
model:
preferred-model:
enabled-skills: []
allowed-tools: []
created: ${created}
---

${systemPrompt || "<!-- Add your assistant's system prompt / persona instructions here. -->"}
`;

		try {
			await this.app.vault.adapter.write(filePath, content);
			await this.loadAssistantByPath(filePath);
			return filePath;
		} catch (e) {
			logger.error(`[AssistantManager] Failed to create assistant at ${filePath}:`, e);
			return null;
		}
	}

	/**
	 * Delete the ASSISTANT.md for the given assistant id.
	 * NOTE: Does not delete the folder itself (memories may live there).
	 */
	async deleteAssistant(id: string): Promise<void> {
		const assistant = this.assistants.get(id);
		if (!assistant) return;

		try {
			const file = this.app.vault.getFileByPath(assistant.filePath);
			if (file) {
				await this.app.fileManager.trashFile(file);
			}
			this.assistants.delete(id);
		} catch (e) {
			logger.error(`[AssistantManager] Failed to delete assistant ${id}:`, e);
		}
	}

	// ---------------------------------------------------------------------------
	// Parsing
	// ---------------------------------------------------------------------------

	static parseAssistantFile(
		raw: string,
		filePath: string,
		assistantsFolder: string
	): Assistant | null {
		// Split frontmatter from body
		const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

		// Derive id from the folder name
		const id = AssistantManager.idFromPath(filePath, assistantsFolder);
		if (!id) return null;

		if (!fmMatch) {
			return {
				id,
				name: id,
				description: "",
				provider: "",
				model: "",
				preferredModel: "",
				enabledSkills: [],
				allowedTools: [],
				created: new Date().toISOString(),
				filePath,
				systemPrompt: raw.trim(),
			};
		}

		const frontmatter = fmMatch[1];
		const body = fmMatch[2].trim();

		const name = AssistantManager.yamlString(frontmatter, "name") ?? id;
		const description = AssistantManager.yamlString(frontmatter, "description") ?? "";
		const provider = AssistantManager.yamlString(frontmatter, "provider") ?? "";
		const model = AssistantManager.yamlString(frontmatter, "model") ?? "";
		const preferredModel = AssistantManager.yamlString(frontmatter, "preferred-model") ?? "";
		const created = AssistantManager.yamlString(frontmatter, "created") ?? new Date().toISOString();
		const enabledSkills = AssistantManager.yamlStringList(frontmatter, "enabled-skills");
		const allowedTools = AssistantManager.yamlStringList(frontmatter, "allowed-tools");

		return {
			id,
			name,
			description,
			provider,
			model,
			preferredModel,
			enabledSkills,
			allowedTools,
			created,
			filePath,
			systemPrompt: body,
		};
	}

	/** Derive an assistant id from its ASSISTANT.md path. */
	private static idFromPath(filePath: string, assistantsFolder: string): string | null {
		const prefix = assistantsFolder.endsWith("/") ? assistantsFolder : assistantsFolder + "/";
		if (!filePath.startsWith(prefix)) return null;
		const relative = filePath.slice(prefix.length); // "my-assistant/ASSISTANT.md"
		const parts = relative.split("/");
		if (parts.length < 2) return null;
		// Accept both ASSISTANT.md and ASSISTANT.md.md
		if (!parts[parts.length - 1].startsWith("ASSISTANT.md")) return null;
		return parts[0];
	}

	// ---------------------------------------------------------------------------
	// Minimal YAML field extractors (same pattern as SkillRegistry / ProjectManager)
	// ---------------------------------------------------------------------------

	private static yamlString(yaml: string, key: string): string | null {
		const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
		const m = yaml.match(re);
		if (!m) return null;
		return m[1].trim().replace(/^["']|["']$/g, "");
	}

	private static yamlStringList(yaml: string, key: string): string[] {
		// Try block sequence: key:\n  - item\n  - item
		const blockRe = new RegExp(`^${key}:[ \\t]*\\r?\\n((?:[ \\t]+-[ \\t]+.+\\r?\\n?)+)`, "m");
		const blockMatch = yaml.match(blockRe);
		if (blockMatch) {
			return blockMatch[1]
				.split(/\r?\n/)
				.map((l) => l.replace(/^\s*-\s*/, "").trim())
				.filter(Boolean);
		}

		// Try inline: key: [item, item]
		const inlineRe = new RegExp(`^${key}:\\s*\\[([^\\]]+)\\]`, "m");
		const inlineMatch = yaml.match(inlineRe);
		if (inlineMatch) {
			return inlineMatch[1]
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
		}

		return [];
	}
}
