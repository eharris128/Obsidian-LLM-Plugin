import { MessageStore } from "./MessageStore";

/**
 * Maintains a map of conversation ID → MessageStore.
 *
 * When two views open the same conversation they receive the same
 * MessageStore instance, so any updates (new messages, streaming chunks)
 * are automatically reflected in both views.
 *
 * Views that hold different conversations get completely independent stores
 * and never interfere with each other.
 */
export class ConversationRegistry {
	private stores = new Map<string, MessageStore>();

	/**
	 * Return the store for the given conversation id, creating one if it
	 * does not exist yet.
	 */
	getOrCreate(id: string): MessageStore {
		if (!this.stores.has(id)) {
			this.stores.set(id, new MessageStore());
		}
		return this.stores.get(id)!;
	}

	/**
	 * Register an existing store under a conversation id.
	 * Used when a new conversation is saved for the first time — the
	 * ephemeral store the view was already using gets promoted into the
	 * registry under its newly-assigned UUID.
	 */
	set(id: string, store: MessageStore): void {
		this.stores.set(id, store);
	}

	has(id: string): boolean {
		return this.stores.has(id);
	}
}
