import { LLMPluginSettings } from "main";
import { OpenAICompatibleConfig } from "Types/types";

/**
 * Gets the currently selected OpenAI-Compatible configuration.
 * Returns null if no config is selected or the selected config doesn't exist.
 */
export function getSelectedConfig(settings: LLMPluginSettings): OpenAICompatibleConfig | null {
	const selectedId = settings.selectedOpenAICompatibleConfigId;
	if (!selectedId) return null;

	return settings.openAICompatibleConfigs.find(c => c.id === selectedId) || null;
}

/**
 * Gets the currently selected OpenAI-Compatible configuration.
 * Throws an error if no config is selected or the selected config doesn't exist.
 * Use this when a valid config is required for operation.
 */
export function getSelectedConfigOrThrow(settings: LLMPluginSettings): OpenAICompatibleConfig {
	const config = getSelectedConfig(settings);

	if (!config) {
		throw new Error(
			"No OpenAI-Compatible API configuration selected. Please select one in Settings."
		);
	}

	return config;
}

/**
 * Ensures that a configuration is selected. If no config is selected but configs exist,
 * auto-selects the first one and returns it.
 * Returns null if no configurations exist.
 *
 * @param settings - Plugin settings
 * @param saveCallback - Optional callback to save settings after auto-selection
 */
export function ensureConfigSelected(
	settings: LLMPluginSettings,
	saveCallback?: () => Promise<void>
): OpenAICompatibleConfig | null {
	const configs = settings.openAICompatibleConfigs;

	// No configs available
	if (configs.length === 0) return null;

	// Check if current selection is valid
	const currentId = settings.selectedOpenAICompatibleConfigId;
	const currentConfig = configs.find(c => c.id === currentId);

	if (currentConfig) {
		// Current selection is valid
		return currentConfig;
	}

	// Auto-select first config
	settings.selectedOpenAICompatibleConfigId = configs[0].id;
	saveCallback?.();

	return configs[0];
}

/**
 * Checks if any OpenAI-Compatible configurations exist.
 */
export function hasConfigs(settings: LLMPluginSettings): boolean {
	return settings.openAICompatibleConfigs.length > 0;
}

/**
 * Validates if a configuration has all required fields filled in.
 * Required fields: name, baseUrl
 * Optional fields: model, apiKey
 *
 * Note: Model is optional because some APIs have defaults or only support one model
 */
export function isConfigValid(config: OpenAICompatibleConfig): boolean {
	return !!(
		config.name?.trim() &&
		config.baseUrl?.trim()
	);
}

/**
 * Gets all valid (complete) configurations.
 */
export function getValidConfigs(settings: LLMPluginSettings): OpenAICompatibleConfig[] {
	return settings.openAICompatibleConfigs.filter(isConfigValid);
}

/**
 * Gets all saved (non-draft) and valid configurations.
 * These are the configs that should appear in model selectors.
 */
export function getSavedConfigs(settings: LLMPluginSettings): OpenAICompatibleConfig[] {
	return settings.openAICompatibleConfigs.filter(
		config => isConfigValid(config) && config.saved === true
	);
}

/**
 * Clears the selected config ID if it matches the given config ID.
 * Used when deleting a configuration.
 *
 * @param settings - Plugin settings
 * @param configId - ID of the config being deleted
 * @returns true if the selection was cleared, false otherwise
 */
export function clearSelectionIfMatches(
	settings: LLMPluginSettings,
	configId: string
): boolean {
	if (settings.selectedOpenAICompatibleConfigId === configId) {
		settings.selectedOpenAICompatibleConfigId = "";
		return true;
	}
	return false;
}
