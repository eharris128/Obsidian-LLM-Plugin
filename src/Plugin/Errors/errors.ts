import { Notice } from "obsidian";

export function settingsErrorHandling(params:any) {
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

export function errorMessages(error: Error, params: any) {
    if(error.message === "Incorrect Settings") {
        settingsErrorHandling(params).forEach(wrongSetting => {
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

    if(error.message === "GPT4All streaming") {
        new Notice("GPT4All is already working on another request. Please wait until that request is done to submit another prompt.")
    }

    if(error.message.includes("SDK installation failed")) {
        new Notice("Claude Code requires a one-time download of the runtime SDK (~69 MB). Please ensure npm is installed and you have an internet connection, then try again.")
    }

    if (isInsufficientBalanceError(error)) {
        const provider = detectProvider(error);
        new Notice(
            `Insufficient API credits for ${provider}. Please add funds to your account.`,
            10000
        );
        return;
    }

    if ((error as any).status === 429 || error.message.includes("Rate limit exceeded")) {
        new Notice(error.message, 8000);
    }
}

function isInsufficientBalanceError(error: Error): boolean {
    const status = (error as any).status;
    const code = (error as any).code;
    const message = error.message?.toLowerCase() ?? "";

    // OpenAI: 429 with insufficient_quota code, or HTTP 402
    if (code === "insufficient_quota") return true;
    if (status === 402) return true;

    // Anthropic: 400 with "credit balance" in message
    if (status === 400 && message.includes("credit balance")) return true;

    // Gemini: billing-related errors
    if (message.includes("billing account") || message.includes("quota exceeded")) return true;
    if (status === 403 && (message.includes("billing") || message.includes("pay-as-you-go"))) return true;

    return false;
}

function detectProvider(error: Error): string {
    const message = error.message?.toLowerCase() ?? "";
    const errorType = (error as any).type ?? "";

    if (message.includes("anthropic") || errorType.includes("authentication") && message.includes("credit")) return "Anthropic";
    if (message.includes("openai") || (error as any).code === "insufficient_quota") return "OpenAI";
    if (message.includes("gemini") || message.includes("google")) return "Google Gemini";
    if (message.includes("billing account")) return "Google Gemini";

    return "your LLM provider";
}