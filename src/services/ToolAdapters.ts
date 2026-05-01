/**
 * ToolAdapters — stateless converters from the neutral NeutralToolDefinition
 * format (defined in ObsidianToolRegistry) to each provider's expected schema.
 *
 * Add a new adapter here when supporting a new provider; the registry itself
 * never needs to change.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { NeutralToolDefinition } from "services/ObsidianToolRegistry";

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

/**
 * Convert neutral tool definitions to Anthropic's `tools` array format.
 * Anthropic uses `input_schema` (JSON Schema object) instead of `parameters`.
 */
export function toAnthropicTools(tools: NeutralToolDefinition[]): Anthropic.Tool[] {
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: t.parameters as Anthropic.Tool["input_schema"],
	}));
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenAI, Ollama, Mistral)
// ---------------------------------------------------------------------------

/**
 * Convert neutral tool definitions to the OpenAI function-calling format.
 * This same shape works for any OpenAI-SDK-compatible endpoint (Ollama, Mistral).
 */
export function toOpenAITools(
	tools: NeutralToolDefinition[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}
