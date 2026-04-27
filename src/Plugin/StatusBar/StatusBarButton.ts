import { ChatContainer } from "Plugin/Components/ChatContainer";
import { Header } from "Plugin/Components/Header";
import { HistoryContainer } from "Plugin/Components/HistoryContainer";
import { SettingsContainer } from "Plugin/Components/SettingsContainer";
import LLMPlugin from "main";
import { setIcon } from "obsidian";
import { getViewInfo, getSettingType, setView } from "utils/utils";
import { models } from "utils/models";

export class StatusBarButton {
	plugin: LLMPlugin;
	private statusBarEl: HTMLElement | null = null;
	private popoverEl: HTMLElement | null = null;
	private chatContainer: ChatContainer | null = null;
	private header: Header | null = null;
	private chatContainerDiv: HTMLElement | null = null;
	private chatHistoryContainer: HTMLElement | null = null;
	private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

	constructor(plugin: LLMPlugin) {
		this.plugin = plugin;
	}

	generate() {
		this.statusBarEl = this.plugin.addStatusBarItem();
		this.statusBarEl.addClass("llm-status-bar-button");

		const iconEl = this.statusBarEl.createSpan();
		iconEl.addClass("llm-status-bar-icon");
		setIcon(iconEl, "mouse-pointer-2");

		const labelEl = this.statusBarEl.createSpan();
		labelEl.addClass("llm-status-bar-label");
		labelEl.setText("Ask AI");

		this.buildPopover();

		this.statusBarEl.addEventListener("click", (e: MouseEvent) => {
			e.stopPropagation();
			this.togglePopover();
		});
	}

	private buildPopover() {
		this.popoverEl = document.body.createDiv();
		this.popoverEl.addClass("llm-status-bar-popover");
		this.popoverEl.style.display = "none";

		const savedHeight = this.plugin.settings.fabViewHeight ?? 600;
		this.popoverEl.style.height = `${savedHeight}px`;

		this.header = new Header(this.plugin, "floating-action-button");
		this.chatContainer = new ChatContainer(
			this.plugin,
			"floating-action-button",
			this.plugin.conversationRegistry
		);
		const historyContainer = new HistoryContainer(
			this.plugin,
			"floating-action-button"
		);
		const settingsContainer = new SettingsContainer(
			this.plugin,
			"floating-action-button"
		);

		// Resize handle sits outside contentArea so it can straddle the top
		// border (mirrors FAB's implementation).
		const resizeHandle = this.popoverEl.createDiv();
		resizeHandle.addClass("fab-resize-handle");

		const contentArea = this.popoverEl.createDiv();
		contentArea.addClass("fab-content-area");

		this.chatContainerDiv = contentArea.createDiv();
		this.chatHistoryContainer = contentArea.createDiv();
		const chatContainerDiv = this.chatContainerDiv;
		const chatHistoryContainer = this.chatHistoryContainer;
		const settingsContainerDiv = contentArea.createDiv();

		this.header.generateHeader(
			contentArea,
			chatContainerDiv,
			chatHistoryContainer,
			settingsContainerDiv,
			this.chatContainer,
			historyContainer,
			settingsContainer
		);

		settingsContainerDiv.setAttr("style", "display: none");
		settingsContainerDiv.addClass("fab-settings-container", "llm-flex");
		chatHistoryContainer.setAttr("style", "display: none");
		chatHistoryContainer.addClass("fab-chat-history-container", "llm-flex");
		chatContainerDiv.addClass("fab-chat-container", "llm-flex");

		const history = this.plugin.settings.promptHistory;
		this.chatContainer.generateChatContainer(chatContainerDiv, this.header);
		historyContainer.generateHistoryContainer(
			chatHistoryContainer,
			history,
			chatContainerDiv,
			this.chatContainer,
			this.header
		);
		settingsContainer.generateSettingsContainer(
			settingsContainerDiv,
			this.header,
			() => this.chatContainer?.syncChips()
		);

		// Resize handle — same logic as FAB, but repositions after each drag
		// so the popover stays anchored above the status bar.
		resizeHandle.addEventListener("pointerdown", (e: PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();
			resizeHandle.setPointerCapture(e.pointerId);
			this.popoverEl?.addClass("is-resizing");

			const startY = e.clientY;
			const startHeight = this.popoverEl?.offsetHeight ?? savedHeight;
			const minHeight = 360;
			const maxHeight = Math.max(
				minHeight,
				(this.popoverEl?.getBoundingClientRect().bottom ?? 600) - 36
			);

			const onPointerMove = (moveEvent: PointerEvent) => {
				const delta = startY - moveEvent.clientY;
				const newHeight = Math.min(
					maxHeight,
					Math.max(minHeight, startHeight + delta)
				);
				if (this.popoverEl) {
					this.popoverEl.style.height = `${newHeight}px`;
					this.repositionPopover();
				}
			};

			const onPointerUp = () => {
				resizeHandle.releasePointerCapture(e.pointerId);
				this.popoverEl?.removeClass("is-resizing");
				resizeHandle.removeEventListener("pointermove", onPointerMove);
				resizeHandle.removeEventListener("pointerup", onPointerUp);
				if (this.popoverEl) {
					this.plugin.settings.fabViewHeight =
						this.popoverEl.offsetHeight;
					this.plugin.saveSettings();
				}
			};

			resizeHandle.addEventListener("pointermove", onPointerMove);
			resizeHandle.addEventListener("pointerup", onPointerUp);
		});
	}

	/** Position the popover directly above the status bar button. */
	private repositionPopover() {
		if (!this.popoverEl || !this.statusBarEl) return;

		const buttonRect = this.statusBarEl.getBoundingClientRect();
		const popoverWidth = this.popoverEl.offsetWidth || 400;
		const popoverHeight = this.popoverEl.offsetHeight;
		const gap = 8;

		// Align right edge of popover with right edge of button; grow upward.
		let left = buttonRect.right - popoverWidth;
		let top = buttonRect.top - popoverHeight - gap;

		// Keep within viewport horizontally
		if (left < gap) left = gap;
		if (left + popoverWidth > window.innerWidth - gap) {
			left = window.innerWidth - popoverWidth - gap;
		}
		// Keep within viewport vertically (shouldn't normally be needed)
		if (top < gap) top = gap;

		this.popoverEl.style.left = `${left}px`;
		this.popoverEl.style.top = `${top}px`;
	}

	private togglePopover() {
		if (!this.popoverEl) return;

		if (this.popoverEl.style.display === "none") {
			const { historyIndex } = getViewInfo(
				this.plugin,
				"floating-action-button"
			);
			setView(this.plugin, "floating-action-button");
			this.plugin.settings.currentIndex = historyIndex;
			this.plugin.saveSettings();

			this.popoverEl.style.display = "flex";

			// Refresh the active-file chip to whichever file is open now.
			this.chatContainer?.refreshActiveFileChip();

			// Clamp persisted height, then position.
			requestAnimationFrame(() => {
				if (!this.popoverEl) return;
				const safeMax = Math.max(
					360,
					this.popoverEl.getBoundingClientRect().bottom - 36
				);
				if (this.popoverEl.offsetHeight > safeMax) {
					this.popoverEl.style.height = `${safeMax}px`;
					this.plugin.settings.fabViewHeight = safeMax;
					this.plugin.saveSettings();
				}
				this.repositionPopover();
			});

			// Dismiss on click outside
			this.clickOutsideHandler = (e: MouseEvent) => {
				if (
					this.popoverEl &&
					!this.popoverEl.contains(e.target as Node) &&
					!this.statusBarEl?.contains(e.target as Node)
				) {
					this.hidePopover();
				}
			};
			// Defer so the current click event doesn't immediately close it.
			setTimeout(() => {
				document.addEventListener("click", this.clickOutsideHandler!);
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
	}

	/**
	 * Open the chat popover with a specific history item pre-loaded.
	 * Called by RecentChatsButton when the user picks a conversation.
	 */
	openAtHistory(index: number) {
		if (!this.chatContainer || !this.chatContainerDiv || !this.chatHistoryContainer) return;

		const settingType = getSettingType("floating-action-button");

		// Update history index and current index in settings
		this.plugin.settings[settingType].historyIndex = index;
		this.plugin.settings.currentIndex = index;

		// Sync model settings from the chosen history item
		const historyItem = this.plugin.settings.promptHistory[index];
		if (historyItem?.modelName && models[historyItem.modelName]) {
			const m = models[historyItem.modelName];
			this.plugin.settings[settingType].modelName = historyItem.modelName;
			this.plugin.settings[settingType].model = m.model;
			this.plugin.settings[settingType].modelType = m.type;
			this.plugin.settings[settingType].modelEndpoint = m.endpoint;
			this.plugin.settings[settingType].endpointURL = m.url;
		}
		this.plugin.saveSettings();

		// Show the popover if it's currently hidden
		if (this.popoverEl?.style.display === "none") {
			setView(this.plugin, "floating-action-button");
			this.popoverEl.style.display = "flex";
			this.chatContainer.refreshActiveFileChip();

			requestAnimationFrame(() => {
				if (!this.popoverEl) return;
				const safeMax = Math.max(
					360,
					this.popoverEl.getBoundingClientRect().bottom - 36
				);
				if (this.popoverEl.offsetHeight > safeMax) {
					this.popoverEl.style.height = `${safeMax}px`;
					this.plugin.settings.fabViewHeight = safeMax;
					this.plugin.saveSettings();
				}
				this.repositionPopover();
			});

			this.clickOutsideHandler = (e: MouseEvent) => {
				if (
					this.popoverEl &&
					!this.popoverEl.contains(e.target as Node) &&
					!this.statusBarEl?.contains(e.target as Node)
				) {
					this.hidePopover();
				}
			};
			setTimeout(() => {
				document.addEventListener("click", this.clickOutsideHandler!);
			}, 0);
		}

		// Load the selected conversation into the chat view
		this.chatContainer.resetChat();
		this.chatHistoryContainer.hide();
		this.chatContainerDiv.show();
		this.chatContainer.setMessages(true);
		const messages = this.chatContainer.getMessages();
		this.chatContainer.generateIMLikeMessages(messages);
		this.chatContainerDiv.querySelector(".messages-div")?.scroll(0, 9999);
		this.header?.setHeader(historyItem?.modelName ?? "");
		this.header?.resetHistoryButton();
	}

	remove() {
		this.hidePopover();
		this.chatContainer?.destroy();
		this.chatContainer = null;
		this.header = null;
		this.chatContainerDiv = null;
		this.chatHistoryContainer = null;
		this.popoverEl?.remove();
		this.popoverEl = null;
		this.statusBarEl?.remove();
		this.statusBarEl = null;
	}
}
