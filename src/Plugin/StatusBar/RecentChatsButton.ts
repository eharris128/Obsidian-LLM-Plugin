import { HistoryItem } from "Types/types";
import LLMPlugin from "main";
import { setIcon } from "obsidian";
import { StatusBarButton } from "./StatusBarButton";

export class RecentChatsButton {
	plugin: LLMPlugin;
	statusBarButton: StatusBarButton;
	private statusBarEl: HTMLElement | null = null;
	private popoverEl: HTMLElement | null = null;
	private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
	private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

	constructor(plugin: LLMPlugin, statusBarButton: StatusBarButton) {
		this.plugin = plugin;
		this.statusBarButton = statusBarButton;
	}

	generate() {
		this.statusBarEl = this.plugin.addStatusBarItem();
		this.statusBarEl.addClass("llm-status-bar-button", "llm-recent-chats-button");

		const iconEl = this.statusBarEl.createSpan();
		iconEl.addClass("llm-status-bar-icon");
		setIcon(iconEl, "clock");

		this.popoverEl = document.body.createDiv();
		this.popoverEl.addClass("llm-recent-chats-popover");
		this.popoverEl.style.display = "none";

		this.statusBarEl.addEventListener("click", (e: MouseEvent) => {
			e.stopPropagation();
			this.togglePopover();
		});
	}

	private renderPopoverContents() {
		if (!this.popoverEl) return;
		this.popoverEl.empty();

		const history = this.plugin.settings.promptHistory;

		// Search input
		const searchWrapper = this.popoverEl.createDiv("llm-recent-chats-search-wrapper");
		const searchInput = searchWrapper.createEl("input", {
			attr: {
				type: "text",
				placeholder: "Search chats…",
				class: "llm-recent-chats-search",
			},
		}) as HTMLInputElement;

		// List container
		const listEl = this.popoverEl.createDiv("llm-recent-chats-list");

		const renderList = (query: string) => {
			listEl.empty();

			if (!history.length) {
				const empty = listEl.createDiv("llm-recent-chats-empty");
				empty.setText("No chat history yet.");
				return;
			}

			// Pair each item with its original index, then reverse so most recent is first
			const indexed = history
				.map((item, index) => ({ item, index }))
				.reverse();

			const filtered = query
				? indexed.filter(({ item }) =>
						this.fuzzyMatch(query.toLowerCase(), this.getItemText(item).toLowerCase())
				  )
				: indexed;

			if (!filtered.length) {
				const empty = listEl.createDiv("llm-recent-chats-empty");
				empty.setText("No matches found.");
				return;
			}

			filtered.forEach(({ item, index }) => {
				const row = listEl.createDiv("llm-recent-chats-item");
				const text = this.getItemText(item);

				const textEl = row.createDiv("llm-recent-chats-item-text");
				textEl.setText(text);

				if (item.modelName) {
					const modelEl = row.createDiv("llm-recent-chats-item-model");
					modelEl.setText(item.modelName);
				}

				row.addEventListener("click", (e) => {
					e.stopPropagation();
					this.hidePopover();
					this.statusBarButton.openAtHistory(index);
				});
			});
		};

		renderList("");

		searchInput.addEventListener("input", () => {
			renderList(searchInput.value);
		});

		// Prevent popover from closing when typing in the search input
		searchInput.addEventListener("click", (e) => e.stopPropagation());

		requestAnimationFrame(() => searchInput.focus());
	}

	private getItemText(item: HistoryItem): string {
		return (item as any).prompt || item.messages?.[0]?.content || "Untitled chat";
	}

	/** Simple fuzzy match: all query chars must appear in text in order. */
	private fuzzyMatch(query: string, text: string): boolean {
		if (!query) return true;
		let qi = 0;
		for (let i = 0; i < text.length && qi < query.length; i++) {
			if (text[i] === query[qi]) qi++;
		}
		return qi === query.length;
	}

	private repositionPopover() {
		if (!this.popoverEl || !this.statusBarEl) return;
		const buttonRect = this.statusBarEl.getBoundingClientRect();
		const popoverWidth = this.popoverEl.offsetWidth || 320;
		const gap = 8;

		// Anchor the bottom edge just above the status bar button so the
		// popover always grows upward and shrinks from the top.
		const bottom = window.innerHeight - buttonRect.top + gap;

		let left = buttonRect.right - popoverWidth;
		if (left < gap) left = gap;
		if (left + popoverWidth > window.innerWidth - gap) {
			left = window.innerWidth - popoverWidth - gap;
		}

		this.popoverEl.style.left = `${left}px`;
		this.popoverEl.style.bottom = `${bottom}px`;
		this.popoverEl.style.top = "";
	}

	private togglePopover() {
		if (!this.popoverEl) return;

		if (this.popoverEl.style.display === "none") {
			this.renderPopoverContents();
			this.popoverEl.style.display = "flex";

			requestAnimationFrame(() => this.repositionPopover());

			this.clickOutsideHandler = (e: MouseEvent) => {
				if (
					this.popoverEl &&
					!this.popoverEl.contains(e.target as Node) &&
					!this.statusBarEl?.contains(e.target as Node)
				) {
					this.hidePopover();
				}
			};
			this.keydownHandler = (e: KeyboardEvent) => {
				if (e.key === "Escape") {
					e.preventDefault();
					this.hidePopover();
				}
			};
			setTimeout(() => {
				document.addEventListener("click", this.clickOutsideHandler!);
				document.addEventListener("keydown", this.keydownHandler!);
			}, 0);
		} else {
			this.hidePopover();
		}
	}

	private hidePopover() {
		if (this.popoverEl) this.popoverEl.style.display = "none";
		if (this.clickOutsideHandler) {
			document.removeEventListener("click", this.clickOutsideHandler);
			this.clickOutsideHandler = null;
		}
		if (this.keydownHandler) {
			document.removeEventListener("keydown", this.keydownHandler);
			this.keydownHandler = null;
		}
	}

	remove() {
		this.hidePopover();
		this.popoverEl?.remove();
		this.popoverEl = null;
		this.statusBarEl?.remove();
		this.statusBarEl = null;
	}
}
