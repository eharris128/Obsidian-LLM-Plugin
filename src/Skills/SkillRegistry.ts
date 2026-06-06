/**
 * SkillRegistry — discovers, parses, and hot-reloads SKILL.md files from a
 * configurable vault folder.
 *
 * Each skill lives at: <rootVaultFolder>/Skills/<skill-name>/SKILL.md (default: AI/Skills)
 *
 * NOTE: We use `vault.adapter` for all file I/O rather than `vault.getMarkdownFiles()`
 * because Obsidian does not always index plugin-adjacent or non-standard folders into
 * its TFile cache. The adapter works directly against the file system and is reliable
 * regardless of Obsidian's internal indexing state.
 *
 * SKILL.md format:
 * ---
 * name: my-skill
 * description: What this skill does
 * allowed-tools:
 *   - obsidian_read_note
 *   - obsidian_search
 * disable-model-invocation: false
 * argument-hint: "[target-note]"
 * ---
 *
 * The body (below the frontmatter) is the system-level instruction block
 * injected into the model's context when the skill is active.
 */

import { App, TFile } from "obsidian";
import { BUILTIN_SKILLS } from "./BuiltinSkills";

export interface ParsedSkill {
	/** Unique key derived from the folder name (also used for /slash invocation). */
	id: string;
	/** Display name from frontmatter `name:`, or falls back to id. */
	name: string;
	/** Description from frontmatter `description:`. */
	description: string;
	/** List of allowed tool names from frontmatter `allowed-tools:`. Empty = all tools allowed. */
	allowedTools: string[];
	/** When true the skill does not pass tools to the model (pure prompt-injection only). */
	disableModelInvocation: boolean;
	/** Hint shown in the chat input when the user types /skill-name. */
	argumentHint: string;
	/** Vault path of the SKILL.md file. */
	filePath: string;
	/** The instruction body (everything below the --- frontmatter block). */
	instructions: string;
}

export class SkillRegistry {
	private skills: Map<string, ParsedSkill> = new Map();
	private skillsFolder: string = "AI/Skills";

	constructor(private app: App) {}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/** Return all discovered skills. */
	getSkills(): ParsedSkill[] {
		return Array.from(this.skills.values());
	}

	/** Look up a skill by id (slug from folder name). */
	getSkill(id: string): ParsedSkill | undefined {
		return this.skills.get(id);
	}

	/** Update the folder to watch and reload all skills from it. */
	async setFolder(folder: string): Promise<void> {
		this.skillsFolder = folder.replace(/\/$/, ""); // strip trailing slash
		await this.reloadAll();
	}

	getFolder(): string {
		return this.skillsFolder;
	}

	/**
	 * Write any missing built-in SKILL.md files into the vault under the current
	 * skills folder. Existing files are never overwritten — user edits are safe.
	 * Call this once before reloadAll() during plugin startup.
	 */
	async seedBuiltinSkills(): Promise<void> {
		if (!this.skillsFolder) return;

		const adapter = this.app.vault.adapter;

		// Ensure the skills folder itself exists
		const folderExists = await adapter.exists(this.skillsFolder);
		if (!folderExists) {
			await adapter.mkdir(this.skillsFolder);
		}

		for (const skill of BUILTIN_SKILLS) {
			const skillDir = `${this.skillsFolder}/${skill.id}`;
			const skillFile = `${skillDir}/SKILL.md`;

			// Only create if the file doesn't already exist
			const fileExists = await adapter.exists(skillFile);
			if (fileExists) continue;

			// Ensure the skill sub-folder exists
			const dirExists = await adapter.exists(skillDir);
			if (!dirExists) {
				await adapter.mkdir(skillDir);
			}

			await adapter.write(skillFile, skill.content);
			console.log(`[SkillRegistry] Seeded built-in skill: ${skill.id}`);
		}
	}

	/**
	 * Scan the skills folder via the vault adapter and parse every SKILL.md found.
	 * Uses adapter.list() so it works even when Obsidian hasn't indexed the files
	 * into its TFile cache.
	 */
	async reloadAll(): Promise<void> {
		this.skills.clear();
		const folderPath = this.skillsFolder;

		let listing: { folders: string[]; files: string[] };
		try {
			listing = await this.app.vault.adapter.list(folderPath);
		} catch {
			// Folder doesn't exist yet — nothing to load
			return;
		}

		// Each skill lives one level down: <skillsFolder>/<skill-id>/SKILL.md
		// When users create a note named "SKILL.md" inside Obsidian, it is saved as
		// "SKILL.md.md" on disk (Obsidian appends .md automatically). Try both.
		for (const subFolder of listing.folders) {
			const candidates = [
				`${subFolder}/SKILL.md`,
				`${subFolder}/SKILL.md.md`,
			];
			for (const candidate of candidates) {
				const exists = await this.app.vault.adapter.exists(candidate);
				if (exists) {
					await this.loadSkillByPath(candidate);
					break; // found it — don't check the other variant
				}
			}
		}
	}

	/**
	 * Load and register a skill from an arbitrary vault-relative path string.
	 * Uses the adapter directly, so it works regardless of Obsidian's TFile cache.
	 */
	async loadSkillByPath(filePath: string): Promise<void> {
		try {
			const exists = await this.app.vault.adapter.exists(filePath);
			if (!exists) return;
			const raw = await this.app.vault.adapter.read(filePath);
			const skill = SkillRegistry.parseSkillFile(raw, filePath, this.skillsFolder);
			if (skill) {
				this.skills.set(skill.id, skill);
				console.log(`[SkillRegistry] Loaded skill: ${skill.id} (${skill.name})`);
			}
		} catch (e) {
			console.error(`[SkillRegistry] Failed to parse ${filePath}:`, e);
		}
	}

	/**
	 * Parse and register a single SKILL.md TFile.
	 * Used when the vault event system fires for an indexed file.
	 * Falls back to adapter-based loading so it always works.
	 */
	async loadSkillFile(file: TFile): Promise<void> {
		await this.loadSkillByPath(file.path);
	}

	/**
	 * Remove a skill by file path (called when the file is deleted or renamed out
	 * of the skills folder).
	 */
	removeByPath(filePath: string): void {
		for (const [id, skill] of this.skills) {
			if (skill.filePath === filePath) {
				this.skills.delete(id);
				return;
			}
		}
	}

	/** True if the given vault path is inside the skills folder and is a SKILL.md (or SKILL.md.md). */
	isSkillFile(path: string): boolean {
		return (
			path.startsWith(this.skillsFolder + "/") &&
			(path.endsWith("/SKILL.md") || path.endsWith("/SKILL.md.md"))
		);
	}

	// ---------------------------------------------------------------------------
	// Parsing
	// ---------------------------------------------------------------------------

	private static parseSkillFile(
		raw: string,
		filePath: string,
		skillsFolder: string
	): ParsedSkill | null {
		// Split frontmatter from body
		const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
		if (!fmMatch) {
			// No frontmatter — treat the whole file as instructions, derive id from path
			const id = SkillRegistry.idFromPath(filePath, skillsFolder);
			if (!id) return null;
			return {
				id,
				name: id,
				description: "",
				allowedTools: [],
				disableModelInvocation: false,
				argumentHint: "",
				filePath,
				instructions: raw.trim(),
			};
		}

		const frontmatter = fmMatch[1];
		const body = fmMatch[2].trim();

		// Derive id from the folder name
		const id = SkillRegistry.idFromPath(filePath, skillsFolder);
		if (!id) return null;

		// Parse simple YAML fields we care about (avoid a full YAML dep)
		const name = SkillRegistry.yamlString(frontmatter, "name") ?? id;
		const description = SkillRegistry.yamlString(frontmatter, "description") ?? "";
		const disableModelInvocation =
			SkillRegistry.yamlBoolean(frontmatter, "disable-model-invocation") ?? false;
		const argumentHint = SkillRegistry.yamlString(frontmatter, "argument-hint") ?? "";
		const allowedTools = SkillRegistry.yamlStringList(frontmatter, "allowed-tools");

		return {
			id,
			name,
			description,
			allowedTools,
			disableModelInvocation,
			argumentHint,
			filePath,
			instructions: body,
		};
	}

	/** Derive a skill id from its SKILL.md path. E.g. "AI/Skills/my-skill/SKILL.md" → "my-skill". */
	private static idFromPath(filePath: string, skillsFolder: string): string | null {
		// filePath: AI/Skills/my-skill/SKILL.md
		// prefix:   AI/Skills/
		const prefix = skillsFolder.endsWith("/") ? skillsFolder : skillsFolder + "/";
		if (!filePath.startsWith(prefix)) return null;
		const relative = filePath.slice(prefix.length); // "my-skill/SKILL.md"
		const parts = relative.split("/");
		if (parts.length < 2 || parts[parts.length - 1] !== "SKILL.md") return null;
		return parts[0]; // "my-skill"
	}

	// ---------------------------------------------------------------------------
	// Minimal YAML field extractors (no external deps)
	// ---------------------------------------------------------------------------

	/** Extract a scalar string value from YAML frontmatter. */
	private static yamlString(yaml: string, key: string): string | null {
		const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
		const m = yaml.match(re);
		if (!m) return null;
		// Strip surrounding quotes if present
		return m[1].trim().replace(/^["']|["']$/g, "");
	}

	/** Extract a boolean value (true/false/yes/no) from YAML frontmatter. */
	private static yamlBoolean(yaml: string, key: string): boolean | null {
		const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
		const m = yaml.match(re);
		if (!m) return null;
		return /^(true|yes)$/i.test(m[1].trim());
	}

	/**
	 * Extract a YAML sequence (list) value from frontmatter.
	 * Supports both block sequences (- item) and inline [item, item].
	 */
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
