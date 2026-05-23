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
		const skills = this.plugin.skillRegistry?.getSkills() ?? [];
		const assistants = this.plugin.assistantManager?.getAssistants() ?? [];
		const projects = this.plugin.projectManager?.getProjects() ?? [];

		// Respect per-item availability (missing key = available by default)
		const availableSkills = skills.filter(
			(s) => settings.availableSkills[s.id] !== false
		);
		const availableAssistants = assistants.filter(
			(a) => settings.availableAssistants[a.id] !== false
		);

		const parts: string[] = [];

		parts.push(
			"You are the Obsidian Agent — an intelligent, always-available assistant " +
			"with full access to the user's Obsidian vault. " +
			"You can read, create, modify, and search notes, and orchestrate complex " +
			"multi-step tasks across the user's knowledge base.\n\n" +
			"Always prefer reading actual vault notes over guessing their contents. " +
			"Use available tools to ground every response in real data."
		);

		// ── Available Skills ──────────────────────────────────────────────────
		if (availableSkills.length > 0) {
			const lines = availableSkills
				.map((s) => `- **${s.name}** (\`/${s.id}\`)${s.description ? ": " + s.description : ""}`)
				.join("\n");
			parts.push(`## Available Skills\n\n${lines}`);
		}

		// ── Available Assistants ──────────────────────────────────────────────
		if (availableAssistants.length > 0) {
			const lines = availableAssistants
				.map(
					(a) =>
						`- **${a.name}** (id: \`${a.id}\`)${a.description ? ": " + a.description : ""}`
				)
				.join("\n");
			parts.push(
				`## Available Assistants\n\n` +
				`You can delegate sub-tasks to specialised assistants using the ` +
				`\`invoke_assistant\` tool. Each assistant has its own persona and expertise:\n\n` +
				`${lines}\n\n` +
				`Call \`invoke_assistant\` when a request clearly aligns with an assistant's ` +
				`domain. You will receive the assistant's persona instructions and should ` +
				`continue the response from that perspective.`
			);
		}

		// ── Projects in the vault ─────────────────────────────────────────────
		if (projects.length > 0) {
			const lines = projects
				.map((p) => `- **${p.name}**${p.description ? ": " + p.description : ""}`)
				.join("\n");
			parts.push(`## Projects in the Vault\n\n${lines}`);
		}

		// ── Chat history ──────────────────────────────────────────────────────
		if (this.plugin.settings.chatHistoryEnabled) {
			const chatFolder = this.plugin.chatHistory.folder;
			const projectsFolder = this.plugin.projectsFolder;
			parts.push(
				`## Chat History\n\n` +
				`Saved conversations are stored as markdown files in the vault. ` +
				`Use the \`get_chat_history\` tool to access them:\n\n` +
				`- **Default chat folder**: \`${chatFolder}/\`\n` +
				`- **Project chats**: \`${projectsFolder}/<project-id>/chats/\`\n\n` +
				`Call \`get_chat_history\` with action \`list\` to browse recent chats ` +
				`(filterable by project or agent flag), or action \`load\` with a file path ` +
				`to read the full conversation. You can also use \`grep_vault\` to search ` +
				`across all chat content by keyword.`
			);
		}

		// ── Write-tool constraints ────────────────────────────────────────────
		// Explicitly prevent the model from writing to the vault unless asked.
		// This guards against smaller/ReAct-fallback models that over-execute
		// and autonomously create notes when only asked to read or search.
		parts.push(
			"## Important: Do Not Write Without Being Asked\n\n" +
			"You must NEVER call `obsidian_create_note`, `obsidian_modify_note`, " +
			"`obsidian_append_note`, `obsidian_patch_note`, `obsidian_insert_after_heading`, " +
			"or `obsidian_update_frontmatter` unless the user has explicitly asked you to " +
			"save, create, write, update, or modify a note.\n\n" +
			"If you think a note would be a useful output after completing a task " +
			"(e.g. after researching something), offer to create one in your response — " +
			"but do not call any write tool automatically. Always ask first."
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

		if (availableAssistants.length === 0) return;

		const assistantIdList = availableAssistants.map((a) => a.id).join(", ");
		const def: NeutralToolDefinition = {
			name: "invoke_assistant",
			displayName: "Invoke Assistant",
			description:
				`Activate a specialised assistant's persona and instructions for a sub-task. ` +
				`Available assistant ids: ${assistantIdList}. ` +
				`Use this when the task clearly aligns with an assistant's domain of expertise.`,
			parameters: {
				type: "object",
				properties: {
					assistant_id: {
						type: "string",
						description:
							`The id of the assistant to invoke (one of: ${assistantIdList}).`,
					},
					task: {
						type: "string",
						description:
							"A clear description of the task for the assistant to handle.",
					},
				},
				required: ["assistant_id", "task"],
			},
			risk: "safe",
		};

		registry.registerDynamicTool(def, async (input: { assistant_id: string; task: string }) => {
			const assistantObj = this.plugin.assistantManager?.getAssistant(input.assistant_id);
			if (!assistantObj) {
				return {
					success: false,
					error: `Assistant "${input.assistant_id}" not found. Available: ${assistantIdList}`,
				};
			}

			// Return the assistant's context to the main agent loop.
			// The model will read this and continue the response from the assistant's perspective.
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
		});
	}

	// ─── Helpers ──────────────────────────────────────────────────────────────

	/** True if any assistants are available to the agent. */
	hasAvailableAssistants(): boolean {
		const settings = this.plugin.settings.obsidianAgentSettings;
		const assistants = this.plugin.assistantManager?.getAssistants() ?? [];
		return assistants.some((a) => settings.availableAssistants[a.id] !== false);
	}
}
