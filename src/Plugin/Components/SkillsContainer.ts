/**
 * SkillsContainer — the Skills tab panel.
 *
 * Displays all skills discovered by SkillRegistry with:
 * - Name, description, /slash-invocation badge, allowed-tools badges
 * - An Obsidian toggle to enable/disable each skill globally (persisted)
 *
 * Mirrors the SettingsContainer/HistoryContainer pattern.
 */

import LLMPlugin from "main";
import { setIcon, ToggleComponent } from "obsidian";
import { ViewType } from "Types/types";

export class SkillsContainer {
	viewType: ViewType;

	constructor(private plugin: LLMPlugin, viewType: ViewType) {
		this.viewType = viewType;
	}

	/** Re-render the container element from scratch. */
	async generateSkillsContainer(parentContainer: HTMLElement): Promise<void> {
		this.resetSkills(parentContainer);

		const skills = this.plugin.skillRegistry?.getSkills() ?? [];
		const skillsFolder = this.plugin.skillsFolder;

		// Header row
		const headerRow = parentContainer.createDiv({ cls: "llm-skills-header" });
		headerRow.createSpan({
			cls: "llm-skills-header-title",
			text: "Available Skills",
		});
		headerRow.createSpan({
			cls: "llm-skills-folder-hint",
			text: skillsFolder,
		});

		if (skills.length === 0) {
			parentContainer.createDiv({
				cls: "llm-skills-empty",
				text: `No skills found. Add SKILL.md files inside vault folder: ${skillsFolder}`,
			});
			return;
		}

		const enabledSkills = this.plugin.settings.skillsSettings?.enabledSkills ?? {};

		for (const skill of skills) {
			const row = parentContainer.createDiv({ cls: "llm-skill-item" });

			// Icon
			const iconEl = row.createDiv({ cls: "llm-skill-icon" });
			setIcon(iconEl, "scroll-text");

			// Info column
			const info = row.createDiv({ cls: "llm-skill-info" });

			const nameEl = info.createDiv({ cls: "llm-skill-name" });
			nameEl.textContent = skill.name;

			if (skill.description) {
				info.createDiv({
					cls: "llm-skill-description",
					text: skill.description,
				});
			}

			// Badge row: /slash-command and allowed-tools chips
			const badges = info.createDiv({ cls: "llm-skill-badges" });

			// Slash invocation badge
			badges.createSpan({
				cls: "llm-skill-badge",
				text: `/${skill.id}${skill.argumentHint ? " " + skill.argumentHint : ""}`,
			});

			// Allowed-tools badges (first 3, then "…")
			if (skill.allowedTools.length > 0) {
				const shown = skill.allowedTools.slice(0, 3);
				for (const toolName of shown) {
					badges.createSpan({ cls: "llm-skill-badge", text: toolName });
				}
				if (skill.allowedTools.length > 3) {
					badges.createSpan({
						cls: "llm-skill-badge",
						text: `+${skill.allowedTools.length - 3} more`,
					});
				}
			} else {
				badges.createSpan({
					cls: "llm-skill-badge",
					text: "all tools",
				});
			}

			// Toggle (right-aligned)
			const toggleWrapper = row.createDiv({ cls: "llm-skill-toggle" });
			const toggle = new ToggleComponent(toggleWrapper);
			toggle.setValue(!!enabledSkills[skill.id]);
			toggle.onChange(async (value) => {
				if (!this.plugin.settings.skillsSettings) return;
				this.plugin.settings.skillsSettings.enabledSkills[skill.id] = value;
				await this.plugin.saveSettings();
			});
		}
	}

	resetSkills(parentContainer: HTMLElement): void {
		parentContainer.empty();
	}
}
