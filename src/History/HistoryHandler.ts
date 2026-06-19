import { HistoryItem, Message } from "Types/types";
import LLMPlugin from "main";

export class History {
	constructor(private plugin: LLMPlugin) {}

	push(message_context: HistoryItem) {
		// When file-based history is active, writes are handled by ChatHistory.
		if (this.plugin.settings.chatHistoryEnabled) return true;
		try {
			const history = this.plugin.settings.promptHistory;
			history.push(message_context);
			this.plugin.settings.promptHistory = history;
			void this.plugin.saveSettings();
			return true;
		} catch {
			return false;
		}
	}

	update(index: number, messages: Message[]) {
		if (this.plugin.settings.chatHistoryEnabled) return;
		this.plugin.settings.promptHistory[index].messages = messages;
		void this.plugin.saveSettings();
	}

	reset() {
		if (this.plugin.settings.chatHistoryEnabled) return;
		this.plugin.settings.promptHistory = [];
		void this.plugin.saveSettings();
	}

	//take in an index from the selected chat history
	//overwrite history with new prompt/additional prompt
	overwriteHistory(messages: Message[], index: number) {
		if (this.plugin.settings.chatHistoryEnabled) return;
		const historyItem = this.plugin.settings.promptHistory[index];
		historyItem.messages = messages;
		this.plugin.settings.promptHistory[index] = historyItem;
		void this.plugin.saveSettings();
	}
}
