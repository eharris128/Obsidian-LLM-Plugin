/**
 * ObsidianAgent — the primary always-available agent for the plugin.
 *
 * Responsibilities:
 *  1. Build the agent's base system prompt from live plugin state
 *     (SkillRegistry, AssistantManager, ProjectManager, user vault guidance).
 *  2. Register the `invoke_assistant` dynamic tool on an ObsidianToolRegistry
 *     so the agent can route sub-tasks to specialised assistants.
 *
 * Routing to Assistants is NOT a separate orchestration layer — it is expressed
 * entirely through the system prompt and the `invoke_assistant` tool result.
 * The main model applies the returned assistant context and continues.
 */

import { TFile } from "obsidian";
import LLMPlugin from "main";
import { ObsidianToolRegistry, NeutralToolDefinition } from "services/ObsidianToolRegistry";

export class ObsidianAgent {
	constructor(private plugin: LLMPlugin) {}

	// ─── System prompt ────────────────────────────────────────────────────────

	/**
	 * Build the complete agent system prompt from current plugin state.
	 * Called once per send (so it always reflects the latest skills/assistants).
	 * Reads the agentGuidanceFile from the vault if configured.
	 */
	async buildSystemPrompt(): Promise<string> {
		const settings = this.plugin.settings.obsidianAgentSettings;
		const assistants = this.plugin.assistantManager?.getAssistants() ?? [];

		// Respect per-item availability (missing key = available by default)
		const availableAssistants = assistants.filter(
			(a) => settings.availableAssistants[a.id] !== false
		);

		const parts: string[] = [];

		// ── Identity ──────────────────────────────────────────────────────────
		parts.push(
			"You are the Obsidian Agent — an intelligent, always-available assistant " +
			"with full access to the user's Obsidian vault. " +
			"You can read, create, modify, and search notes, and orchestrate complex " +
			"multi-step tasks across the user's knowledge base.\n\n" +
			"Always prefer reading actual vault notes over guessing their contents. " +
			"Use available tools to ground every response in real data."
		);

		// ── Available Assistants (one-liner) ──────────────────────────────────
		// Full names, IDs, and descriptions are already in the invoke_assistant
		// tool definition — no need to repeat them here. A brief routing cue is
		// enough to remind the model the mechanism exists.
		if (availableAssistants.length > 0) {
			parts.push(
				"Use the `invoke_assistant` tool to delegate tasks to a specialised assistant. " +
				"Each assistant's name, id, and description are listed in the tool definition."
			);
		}

		// ── Write-tool guidance ───────────────────────────────────────────────
		// Keep this short and imperative. Small models ignore nuanced prose and
		// stall after reading instead of proceeding to write. Two simple rules:
		// 1. User asked to write → do it (read first, then write).
		// 2. User didn't ask but a note would help → offer first, don't auto-write.
		// The Permission Mode setting gates writes behind user approval regardless.
		parts.push(
			"## Vault Write Tools\n\n" +
			"If the user asks you to create, add to, or modify a note: read it first if it exists, then make the change immediately using the appropriate tool. Do not stop to summarise or ask for confirmation — complete the action.\n\n" +
			"If the user did not ask for a write action but you think creating a note would be useful, offer it rather than writing automatically."
		);

		// ── Agent guidance file ───────────────────────────────────────────────
		// Read the vault-native guidance file if one is configured.
		const guidancePath = settings.agentGuidanceFile?.trim();
		if (guidancePath) {
			try {
				const abstract = this.plugin.app.vault.getAbstractFileByPath(guidancePath);
				if (abstract instanceof TFile) {
					const content = await this.plugin.app.vault.read(abstract);
					if (content.trim()) {
						parts.push(`## Vault Guidance\n\n${content.trim()}`);
					}
				}
			} catch (e) {
				console.warn("[ObsidianAgent] Could not read agent guidance file:", e);
			}
		}

		return parts.join("\n\n");
	}

	// ─── Dynamic tool registration ────────────────────────────────────────────

	/**
	 * Register the `invoke_assistant` tool on a registry instance.
	 * Call this just before constructing AgentLoop so the tool is available
	 * to the model during the agent turn.
	 *
	 * No-op when no assistants are agent-available (avoids confusing the model
	 * with a tool it can never usefully call).
	 */
	registerTools(registry: ObsidianToolRegistry): void {
		const settings = this.plugin.settings.obsidianAgentSettings;
		const assistants = this.plugin.assistantManager?.getAssistants() ?? [];
		const availableAssistants = assistants.filter(
			(a) => settings.availableAssistants[a.id] !== false
		);
		const availableSkills = (this.plugin.skillRegistry?.getSkills() ?? []).filter(
			(s) => settings.availableSkills[s.id] !== false
		);

		// ── list_skills ───────────────────────────────────────────────────────
		// Always registered so the model can discover skills on demand, even
		// when no assistants are configured.
		registry.registerDynamicTool(
			{
				name: "list_skills",
				displayName: "List Skills",
				description:
					"Return the list of vault skills the user can invoke via /skill-name. " +
					"Call this when the user asks what skills are available, or when you think " +
					"a skill might be useful for their request and want to suggest one.",
				parameters: { type: "object", properties: {}, required: [] },
				risk: "safe",
			},
			async () => {
				if (availableSkills.length === 0) {
					return { success: true, result: "No skills are currently available in this vault." };
				}
				const lines = availableSkills.map((s) => {
					const hint = s.argumentHint ? ` ${s.argumentHint}` : "";
					const desc = s.description ? `: ${s.description}` : "";
					return `- **${s.name}** (\`/${s.id}${hint}\`)${desc}`;
				});
				return { success: true, result: `## Available Skills\n\n${lines.join("\n")}` };
			}
		);

		// ── list_projects ─────────────────────────────────────────────────────
		registry.registerDynamicTool(
			{
				name: "list_projects",
				displayName: "List Projects",
				description:
					"Return all projects in the vault with their names, ids, and descriptions. " +
					"Call this when the user asks about their projects or wants to know what " +
					"projects exist before switching context or asking project-specific questions.",
				parameters: { type: "object", properties: {}, required: [] },
				risk: "safe",
			},
			async () => {
				const projects = this.plugin.projectManager?.getProjects() ?? [];
				if (projects.length === 0) {
					return { success: true, result: "No projects found in the vault." };
				}
				const lines = projects.map((p) => {
					const desc = p.description ? `: ${p.description}` : "";
					const pinned = p.pinnedNotes.length > 0
						? ` (${p.pinnedNotes.length} pinned note${p.pinnedNotes.length > 1 ? "s" : ""})`
						: "";
					return `- **${p.name}** (id: \`${p.id}\`)${desc}${pinned}`;
				});
				return { success: true, result: `## Projects in the Vault\n\n${lines.join("\n")}` };
			}
		);

		// ── invoke_assistant ──────────────────────────────────────────────────
		// Only registered when assistants are available — avoids presenting a
		// tool the model can never usefully call.
		if (availableAssistants.length === 0) return;

		const assistantIdList = availableAssistants.map((a) => a.id).join(", ");
		const assistantRoster = availableAssistants
			.map((a) => `- ${a.id} (${a.name})${a.description ? ": " + a.description : ""}`)
			.join("\n");

		registry.registerDynamicTool(
			{
				name: "invoke_assistant",
				displayName: "Invoke Assistant",
				description:
					`Activate a specialised assistant's persona and instructions for a sub-task. ` +
					`Use this when a request clearly aligns with an assistant's domain of expertise.\n\n` +
					`Available assistants:\n${assistantRoster}`,
				parameters: {
					type: "object",
					properties: {
						assistant_id: {
							type: "string",
							description: `The id of the assistant to invoke (one of: ${assistantIdList}).`,
						},
						task: {
							type: "string",
							description: "A clear description of the task for the assistant to handle.",
						},
					},
					required: ["assistant_id", "task"],
				},
				risk: "safe",
			},
			async (input: { assistant_id: string; task: string }) => {
				const assistantObj = this.plugin.assistantManager?.getAssistant(input.assistant_id);
				if (!assistantObj) {
					return {
						success: false,
						error: `Assistant "${input.assistant_id}" not found. Available: ${assistantIdList}`,
					};
				}

				const contextLines: string[] = [
					`You are now operating as "${assistantObj.name}".`,
				];
				if (assistantObj.description) {
					contextLines.push(`Role: ${assistantObj.description}`);
				}
				if (assistantObj.systemPrompt?.trim()) {
					contextLines.push(
						`\nApply the following persona instructions:\n\n${assistantObj.systemPrompt.trim()}`
					);
				}
				contextLines.push(`\nTask to handle: ${input.task}`);

				return { success: true, result: contextLines.join("\n") };
			}
		);
	}

	// ─── Helpers ──────────────────────────────────────────────────────────────

	/** True if any assistants are available to the agent. */
	hasAvailableAssistants(): boolean {
		const settings = this.plugin.settings.obsidianAgentSettings;
		const assistants = this.plugin.assistantManager?.getAssistants() ?? [];
		return assistants.some((a) => settings.availableAssistants[a.id] !== false);
	}
}
