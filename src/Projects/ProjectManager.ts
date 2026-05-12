/**
 * ProjectManager — discovers, parses, and hot-reloads PROJECT.md files from
 * the AI/Projects/ folder inside the user's vault.
 *
 * Each project lives at: <rootVaultFolder>/Projects/<project-id>/PROJECT.md
 *
 * NOTE: We use `vault.adapter` for all file I/O (same pattern as SkillRegistry)
 * because Obsidian does not always index plugin-adjacent or non-standard folders
 * into its TFile cache.
 *
 * PROJECT.md format:
 * ---
 * name: My Project
 * description: What this project is about
 * pinned-notes:
 *   - path/to/note.md
 *   - path/to/another.md
 * default-assistant: My Assistant
 * created: 2024-01-01T00:00:00.000Z
 * ---
 *
 * The body (below the frontmatter) is the system-level instruction block
 * injected as a system prompt prefix for every conversation in this project.
 */

import { App, TFile } from "obsidian";
import { Project } from "Types/types";

export class ProjectManager {
	private projects: Map<string, Project> = new Map();
	private projectsFolder: string = "AI/Projects";

	constructor(private app: App) {}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/** Return all discovered projects. */
	getProjects(): Project[] {
		return Array.from(this.projects.values());
	}

	/** Look up a project by id (slug from folder name). */
	getProject(id: string | null | undefined): Project | null {
		if (!id) return null;
		return this.projects.get(id) ?? null;
	}

	/** Update the folder to watch and reload all projects from it. */
	async setFolder(folder: string): Promise<void> {
		this.projectsFolder = folder.replace(/\/$/, "");
		await this.reloadAll();
	}

	getFolder(): string {
		return this.projectsFolder;
	}

	/**
	 * Scan the projects folder via the vault adapter and parse every PROJECT.md found.
	 */
	async reloadAll(): Promise<void> {
		this.projects.clear();
		const folderPath = this.projectsFolder;

		let listing: { folders: string[]; files: string[] };
		try {
			listing = await this.app.vault.adapter.list(folderPath);
		} catch {
			// Folder doesn't exist yet — nothing to load
			return;
		}

		// Each project lives one level down: <projectsFolder>/<project-id>/PROJECT.md
		for (const subFolder of listing.folders) {
			const candidates = [
				`${subFolder}/PROJECT.md`,
				`${subFolder}/PROJECT.md.md`,
			];
			for (const candidate of candidates) {
				const exists = await this.app.vault.adapter.exists(candidate);
				if (exists) {
					await this.loadProjectByPath(candidate);
					break;
				}
			}
		}
	}

	/**
	 * Load and register a project from an arbitrary vault-relative path string.
	 */
	async loadProjectByPath(filePath: string): Promise<void> {
		try {
			const exists = await this.app.vault.adapter.exists(filePath);
			if (!exists) return;
			const raw = await this.app.vault.adapter.read(filePath);
			const project = ProjectManager.parseProjectFile(raw, filePath, this.projectsFolder);
			if (project) {
				this.projects.set(project.id, project);
				console.log(`[ProjectManager] Loaded project: ${project.id} (${project.name})`);
			}
		} catch (e) {
			console.error(`[ProjectManager] Failed to parse ${filePath}:`, e);
		}
	}

	/** Parse and register a single PROJECT.md TFile. */
	async loadProjectFile(file: TFile): Promise<void> {
		await this.loadProjectByPath(file.path);
	}

	/**
	 * Remove a project by file path (called when deleted or renamed out of folder).
	 */
	removeByPath(filePath: string): void {
		for (const [id, project] of this.projects) {
			if (project.filePath === filePath) {
				this.projects.delete(id);
				return;
			}
		}
	}

	/** True if the given vault path is a PROJECT.md inside the projects folder. */
	isProjectFile(path: string): boolean {
		return (
			path.startsWith(this.projectsFolder + "/") &&
			(path.endsWith("/PROJECT.md") || path.endsWith("/PROJECT.md.md"))
		);
	}

	// ---------------------------------------------------------------------------
	// Create / delete helpers
	// ---------------------------------------------------------------------------

	/**
	 * Create a new project folder and a template PROJECT.md.
	 * Returns the vault path to the created PROJECT.md, or null on failure.
	 */
	async createProject(id: string, name: string, description: string): Promise<string | null> {
		const folderPath = `${this.projectsFolder}/${id}`;
		const filePath = `${folderPath}/PROJECT.md`;

		// Ensure parent hierarchy exists
		const rootExists = await this.app.vault.adapter.exists(this.projectsFolder);
		if (!rootExists) {
			await this.app.vault.adapter.mkdir(this.projectsFolder);
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
pinned-notes: []
created: ${created}
---

<!-- Add your project system instructions here. These will be injected as a system prompt prefix for every conversation in this project. -->
`;

		try {
			await this.app.vault.adapter.write(filePath, content);
			await this.loadProjectByPath(filePath);
			return filePath;
		} catch (e) {
			console.error(`[ProjectManager] Failed to create project at ${filePath}:`, e);
			return null;
		}
	}

	/**
	 * Delete the PROJECT.md for the given project id.
	 * NOTE: Does not delete the folder itself (user may have other files there).
	 */
	async deleteProject(id: string): Promise<void> {
		const project = this.projects.get(id);
		if (!project) return;

		try {
			const file = this.app.vault.getFileByPath(project.filePath);
			if (file) {
				await this.app.vault.trash(file, true);
			}
			this.projects.delete(id);
		} catch (e) {
			console.error(`[ProjectManager] Failed to delete project ${id}:`, e);
		}
	}

	// ---------------------------------------------------------------------------
	// Parsing
	// ---------------------------------------------------------------------------

	static parseProjectFile(
		raw: string,
		filePath: string,
		projectsFolder: string
	): Project | null {
		// Split frontmatter from body
		const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

		// Derive id from the folder name
		const id = ProjectManager.idFromPath(filePath, projectsFolder);
		if (!id) return null;

		if (!fmMatch) {
			return {
				id,
				name: id,
				description: "",
				pinnedNotes: [],
				filePath,
				created: new Date().toISOString(),
				instructions: raw.trim(),
			};
		}

		const frontmatter = fmMatch[1];
		const body = fmMatch[2].trim();

		const name = ProjectManager.yamlString(frontmatter, "name") ?? id;
		const description = ProjectManager.yamlString(frontmatter, "description") ?? "";
		const created = ProjectManager.yamlString(frontmatter, "created") ?? new Date().toISOString();
		const defaultAssistant = ProjectManager.yamlString(frontmatter, "default-assistant") ?? undefined;
		const pinnedNotes = ProjectManager.yamlStringList(frontmatter, "pinned-notes");

		return {
			id,
			name,
			description,
			pinnedNotes,
			defaultAssistant,
			created,
			filePath,
			instructions: body,
		};
	}

	/** Derive a project id from its PROJECT.md path. E.g. "AI/Projects/my-project/PROJECT.md" → "my-project". */
	private static idFromPath(filePath: string, projectsFolder: string): string | null {
		const prefix = projectsFolder.endsWith("/") ? projectsFolder : projectsFolder + "/";
		if (!filePath.startsWith(prefix)) return null;
		const relative = filePath.slice(prefix.length); // "my-project/PROJECT.md"
		const parts = relative.split("/");
		if (parts.length < 2) return null;
		// Accept both PROJECT.md and PROJECT.md.md
		if (!parts[parts.length - 1].startsWith("PROJECT.md")) return null;
		return parts[0];
	}

	// ---------------------------------------------------------------------------
	// Minimal YAML field extractors (same pattern as SkillRegistry)
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
				.map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""))
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
