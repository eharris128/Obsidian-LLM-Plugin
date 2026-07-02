import { Notice } from "obsidian";
import { getErrorMessage, getErrorStatus } from "utils/errorUtils";

export function settingsErrorHandling(params: Record<string, unknown>) {
    const settings = Object.keys(params)
    const errors: string[] = []
    settings.map((setting) => {
        if(params[setting] === "quality") return;
        if(!params[setting]) {
            errors.push(`Request must include ${setting.toUpperCase()}`)
        }
    })

    return errors
}

export function errorMessages(error: unknown, params?: object) {
    const message = getErrorMessage(error);
    const status = getErrorStatus(error);
    if(message === "Incorrect Settings") {
        settingsErrorHandling((params ?? {}) as Record<string, unknown>).forEach(wrongSetting => {
            new Notice(wrongSetting)
        })
    }
    if (message === "Failed to fetch") {
        new Notice(
            "You must have GPT4All open with the API Server enabled"
        );
    }

    if(message === "No API Key") {
        new Notice("You must have an API key to access OpenAI models")
    }

    // New-style API key errors thrown by ChatContainer before making any API call.
    // The message already contains actionable text so we surface it directly.
    if (
        message.includes("API key configured") ||
        message.includes("No Mistral API key") ||
        message.includes("No Claude Code OAuth token")
    ) {
        new Notice(message, 8000);
    }

    if(message === "GPT4All streaming") {
        new Notice("GPT4All is already working on another request. Please wait until that request is done to submit another prompt.")
    }

    if(message.includes("SDK installation failed")) {
        new Notice("Claude Code runtime SDK installation failed. Use the 'Download SDK' button in Settings → Anthropic → Claude Code to install it.", 10000);
    }

    if (status === 429 || message.includes("Rate limit exceeded")) {
        new Notice(message, 8000);
    }

    if (status === 402 || message.toLowerCase().includes("credit balance") || message.toLowerCase().includes("insufficient credits") || message.toLowerCase().includes("billing")) {
        new Notice("Your API credit balance is too low. Add credits at console.anthropic.com/settings/billing.", 10000);
    }

    if (status === 401 || message.toLowerCase().includes("authentication") || message.toLowerCase().includes("invalid x-api-key") || (message.toLowerCase().includes("api key") && message.toLowerCase().includes("missing"))) {
        new Notice("Invalid or missing API key. Check your key in Settings → Model Providers.", 8000);
    }
}