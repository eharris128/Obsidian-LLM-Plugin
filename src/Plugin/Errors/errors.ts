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
}