/**
 * ToolSupportTier — classifies LLM models by their native tool-calling reliability.
 *
 * Tier 1 — reliable native tool calling:
 *   All Anthropic, OpenAI, and Mistral (API) models; Ollama/lmStudio models on
 *   the known-good list below.
 *
 * Tier 2 — unreliable / unknown:
 *   Ollama or lmStudio models NOT on the known-good list.  These may support
 *   the tool-call wire format but produce inconsistent or over-eager results.
 *   The agent should never auto-approve write tools for these models.
 *
 * (Tier 3 — no tool support — is handled upstream by supportsAgentMode().)
 */

/** Provider constants (must match the values used in ChatContainer). */
const TIER1_PROVIDERS = new Set(["claude", "openai", "mistral", "gemini"]);

/**
 * Ollama / lmStudio model name substrings that are known to support
 * structured tool calling reliably.  Matching is case-insensitive against
 * the full model string (e.g. "qwen2.5:14b", "llama3.2:latest").
 */
const KNOWN_GOOD_LOCAL_MODELS: string[] = [
	"llama3.1",
	"llama3.2",
	"llama3.3",
	"qwen2.5",
	"qwen2.5-coder",
	"qwen3",
	"mistral",
	"mixtral",
	"hermes3",
	"command-r",
	"firefunction",
	"functionary",
	"nexusraven",
	"granite3",
];

export type ToolTier = "tier1" | "tier2";

/**
 * Return the tool-support tier for a given provider + model combination.
 *
 * @param modelType  The provider string (e.g. "claude", "ollama", "openai").
 * @param model      The raw model identifier (e.g. "qwen2.5:14b", "gpt-4o").
 */
export function getToolTier(modelType: string, model: string): ToolTier {
	// Cloud providers with reliable structured tool calling.
	if (TIER1_PROVIDERS.has(modelType)) return "tier1";

	// Local providers — check against known-good list.
	if (modelType === "ollama" || modelType === "lmStudio") {
		const lower = model.toLowerCase();
		if (KNOWN_GOOD_LOCAL_MODELS.some((name) => lower.includes(name))) {
			return "tier1";
		}
		return "tier2";
	}

	// Unknown provider — treat conservatively.
	return "tier2";
}

/**
 * Given the user's configured permissionMode, return the effective mode to use
 * for a model at the given tier.
 *
 * Tier 2 models must never auto-approve write tools — downgrade "auto-approve"
 * to "ask" so the user always sees a confirmation dialog for vault writes.
 */
export function effectivePermissionMode(
	configured: string,
	tier: ToolTier
): string {
	if (tier === "tier2" && configured === "auto-approve") {
		return "ask";
	}
	return configured;
}
