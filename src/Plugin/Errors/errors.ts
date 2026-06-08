import { Notice } from "obsidian";

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

export function errorMessages(error: Error, params?: object) {
    if(error.message === "Incorrect Settings") {
        settingsErrorHandling((params ?? {}) as Record<string, unknown>).forEach(wrongSetting => {
            new Notice(wrongSetting)
        })
    }
    if (error.message === "Failed to fetch") {
        new Notice(
            "You must have GPT4All open with the API Server enabled"
        );
    }

    if(error.message === "No API Key") {
        new Notice("You must have an API key to access OpenAI models")
    }

    // New-style API key errors thrown by ChatContainer before making any API call.
    // The message already contains actionable text so we surface it directly.
    if (
        error.message.includes("API key configured") ||
        error.message.includes("No Mistral API key") ||
        error.message.includes("No Claude Code OAuth token")
    ) {
        new Notice(error.message, 8000);
    }

    if(error.message === "GPT4All streaming") {
        new Notice("GPT4All is already working on another request. Please wait until that request is done to submit another prompt.")
    }

    if(error.message.includes("SDK installation failed")) {
        new Notice("Claude Code requires a one-time download of the runtime SDK (~69 MB). Please ensure npm is installed and you have an internet connection, then try again.")
    }

    if ((error as { status?: number }).status === 429 || error.message.includes("Rate limit exceeded")) {
        new Notice(error.message, 8000);
    }

    if ((error as { status?: number }).status === 402 || error.message.toLowerCase().includes("credit balance") || error.message.toLowerCase().includes("insufficient credits") || error.message.toLowerCase().includes("billing")) {
        new Notice("Your API credit balance is too low. Add credits at console.anthropic.com/settings/billing.", 10000);
    }

    if ((error as { status?: number }).status === 401 || error.message.toLowerCase().includes("authentication") || error.message.toLowerCase().includes("invalid x-api-key") || (error.message.toLowerCase().includes("api key") && error.message.toLowerCase().includes("missing"))) {
        new Notice("Invalid or missing API key. Check your key in Settings → Model Providers.", 8000);
    }
}