import { ChatContainer } from "Plugin/Components/ChatContainer";
import { logger } from "../../utils/logger";
import { Header } from "Plugin/Components/Header";
import { HistoryContainer } from "Plugin/Components/HistoryContainer";
import { SettingsContainer } from "Plugin/Components/SettingsContainer";
import LLMPlugin from "main";
import { ButtonComponent, Notice } from "obsidian";
import { classNames } from "utils/classNames";
import { getSettingType, getViewInfo, setHistoryFilePath, setView } from "utils/utils";
import { models } from "utils/models";

const ROOT_WORKSPACE_CLASS = ".mod-vertical.mod-root";

export class FAB {
	plugin: LLMPlugin;
	private chatContainer: ChatContainer | null = null;
	private fabHeader: Header | null = null;
	private fabChatContainerDiv: HTMLElement | null = null;
	private fabChatHistoryContainer: HTMLElement | null = null;
	private fabViewArea: HTMLElement | null = null;
	/** The mounted FAB root — removal must target this exact element (popout safety). */
	private fabContainerEl: HTMLElement | null = null;

	constructor(plugin: LLMPlugin) {
		this.plugin = plugin;
	}

	generateFAB() {
		const fabContainer = createDiv();
		fabContainer.addEventListener("mouseenter", () => {
			const { historyIndex } = getViewInfo(
				this.plugin,
				"floating-action-button"
			);
			setView(this.plugin, "floating-action-button");
			this.plugin.settings.currentIndex = historyIndex;
			void this.plugin.saveSettings();
		});
		fabContainer.setAttribute("class", `floating-action-button`);
		fabContainer.setAttribute("id", "_floating-action-button");
		const viewArea = fabContainer.createDiv();
		viewArea.addClass("fab-view-area");

		// Visibility is toggled via the .llm-hidden class so it can never clobber
		// the inline height (the resize handle writes the height via setCssStyles).
		const savedHeight = this.plugin.settings.fabViewHeight ?? 600;
		viewArea.addClass("llm-hidden");
		viewArea.setCssStyles({ height: `${savedHeight}px` });

		this.fabViewArea = viewArea;

		const header = new Header(this.plugin, "floating-action-button");
		this.fabHeader = header;
		this.chatContainer = new ChatContainer(
			this.plugin,
			"floating-action-button",
			this.plugin.conversationRegistry
		);
		const chatContainer = this.chatContainer;
		// Enable agent mode when the Obsidian Agent feature is on or set as default.
		if (this.plugin.settings.obsidianAgentSettings?.enabled || this.plugin.settings.defaultAgentMode) {
			chatContainer.isObsidianAgent = true;
		}
		// Wire the header title callback so the title updates when the first message is sent.
		chatContainer.headerTitleCallback = (title: string) => header.setTitle(title);
		const historyContainer = new HistoryContainer(
			this.plugin,
			"floating-action-button"
		);
		const settingsContainer = new SettingsContainer(
			this.plugin,
			"floating-action-button",
			chatContainer
		);
		// Resize handle lives directly on viewArea (outside contentArea) so it
		// can straddle the top border with a negative top offset. overflow:hidden
		// is on contentArea instead, keeping it off viewArea so the handle isn't
		// clipped.
		const resizeHandle = viewArea.createDiv();
		resizeHandle.addClass("fab-resize-handle");
		// Hover affordance for the top border — a class toggle instead of the
		// CSS :has() selector the community review flags.
		resizeHandle.addEventListener("mouseenter", () => viewArea.addClass("llm-handle-hover"));
		resizeHandle.addEventListener("mouseleave", () => viewArea.removeClass("llm-handle-hover"));

		// All scrollable/clipped content goes in contentArea, which carries
		// overflow:hidden so the resize handle is unaffected.
		const contentArea = viewArea.createDiv();
		contentArea.addClass("fab-content-area");

		const lineBreak = contentArea.createDiv();
		const chatContainerDiv = contentArea.createDiv();
		const chatHistoryContainer = contentArea.createDiv();
		this.fabChatContainerDiv = chatContainerDiv;
		this.fabChatHistoryContainer = chatHistoryContainer;
		const settingsContainerDiv = contentArea.createDiv();
		header.generateHeader(
			contentArea,
			chatContainerDiv,
			chatHistoryContainer,
			settingsContainerDiv,
			chatContainer,
			historyContainer,
			settingsContainer,
			() => { viewArea.addClass("llm-hidden"); }
		);

		resizeHandle.addEventListener("pointerdown", (e: PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();
			// setPointerCapture routes all future pointer events to this element
			// even when the cursor leaves it — no global listeners needed.
			resizeHandle.setPointerCapture(e.pointerId);
			viewArea.addClass("is-resizing");

			const startY = e.clientY;
			const startHeight = viewArea.offsetHeight;
			const minHeight = 360;
			// Compute the position-aware max height: the card grows upward from
			// a fixed bottom anchor, so bottom - 36px keeps the drag handle
			// at least 36px from the top of the viewport and always reachable.
			const maxHeight = Math.max(
				minHeight,
				viewArea.getBoundingClientRect().bottom - 36
			);

			const onPointerMove = (moveEvent: PointerEvent) => {
				// Dragging up (negative delta) increases height since the FAB
				// is anchored to the bottom-right corner.
				const delta = startY - moveEvent.clientY;
				const newHeight = Math.min(
					maxHeight,
					Math.max(minHeight, startHeight + delta)
				);
				viewArea.setCssStyles({ height: `${newHeight}px` });
			};

			const onPointerUp = () => {
				resizeHandle.releasePointerCapture(e.pointerId);
				viewArea.removeClass("is-resizing");
				resizeHandle.removeEventListener("pointermove", onPointerMove);
				resizeHandle.removeEventListener("pointerup", onPointerUp);
				// Persist the new height
				this.plugin.settings.fabViewHeight = viewArea.offsetHeight;
				void this.plugin.saveSettings();
			};

			resizeHandle.addEventListener("pointermove", onPointerMove);
			resizeHandle.addEventListener("pointerup", onPointerUp);
		});

		const history = this.plugin.settings.promptHistory;

		settingsContainerDiv.hide();
		settingsContainerDiv.addClass("fab-settings-container", "llm-flex");
		chatHistoryContainer.hide();
		chatHistoryContainer.addClass("fab-chat-history-container", "llm-flex");
		lineBreak.className =
			classNames["floating-action-button"]["title-border"];
		chatContainerDiv.addClass("fab-chat-container", "llm-flex");

		void chatContainer.generateChatContainer(chatContainerDiv, header);
		historyContainer.generateHistoryContainer(
			chatHistoryContainer,
			history,
			chatContainerDiv,
			chatContainer,
			header
		);
		void settingsContainer.generateSettingsContainer(settingsContainerDiv);

		const button = new ButtonComponent(fabContainer);
		button
			.setIcon("bot-message-square")
			.setClass("buttonItem")
			.onClick(() => {
				if (viewArea.hasClass("llm-hidden")) {
					viewArea.removeClass("llm-hidden");
					// Sync the model dropdown to reflect any settings changes made
					// while the FAB was closed (the container is built once, so it
					// won't pick up new defaults automatically).
					chatContainer.syncModelDropdown();
					// Clamp any persisted oversized height after the element is
					// visible and laid out so getBoundingClientRect() is accurate.
					window.requestAnimationFrame(() => {
						const safeMax = Math.max(
							360,
							viewArea.getBoundingClientRect().bottom - 36
						);
						if (viewArea.offsetHeight > safeMax) {
							viewArea.setCssStyles({ height: `${safeMax}px` });
							this.plugin.settings.fabViewHeight = safeMax;
							void this.plugin.saveSettings();
						}
					});
				} else {
					viewArea.addClass("llm-hidden");
				}
			});

		activeDocument.body
			.querySelector(ROOT_WORKSPACE_CLASS)
			?.insertAdjacentElement("afterbegin", fabContainer);
		// Keep a direct reference so removeFab() can tear down the exact element
		// we mounted, regardless of which window is active at removal time.
		this.fabContainerEl = fabContainer;
	}

	/** Delegates to ChatContainer so the empty state re-renders with the latest settings. */
	refreshEmptyState() {
		this.chatContainer?.refreshEmptyState();
	}

	/** Rebuilds the assistants optgroup in the model dropdown after hot-reload. */
	syncAssistantDropdownOptions() {
		this.chatContainer?.syncAssistantDropdownOptions();
	}

	/** Re-syncs the selected value in the model dropdown to match current settings. */
	syncModelDropdown() {
		this.chatContainer?.syncModelDropdown();
	}

	syncChips() {
		this.chatContainer?.syncChips();
	}

	syncMicButton() {
		this.chatContainer?.syncMicButton();
	}

	/** Sets agent mode on the chat container and refreshes the dropdown. */
	setAgentMode(enabled: boolean) {
		if (this.chatContainer) {
			this.chatContainer.isObsidianAgent = enabled;
			this.chatContainer.syncModelDropdown();
		}
	}

	/**
	 * Open the FAB with a file-based conversation pre-loaded.
	 * Shows the FAB panel if it's currently hidden, then loads the conversation.
	 */
	openAtHistoryFile(filePath: string) {
		if (!this.chatContainer || !this.fabChatContainerDiv || !this.fabChatHistoryContainer || !this.fabHeader) return;

		// Use the resolved settings key ("fabSettings") so TS can verify the
		// property accesses — avoids the TS7053 implicit-any index error.
		const settingType = getSettingType("floating-action-button") as "fabSettings";

		// Show the FAB view area if it's currently hidden
		if (this.fabViewArea?.hasClass("llm-hidden")) {
			this.fabViewArea.removeClass("llm-hidden");
			this.chatContainer.syncModelDropdown();
			window.requestAnimationFrame(() => {
				if (!this.fabViewArea) return;
				const safeMax = Math.max(360, this.fabViewArea.getBoundingClientRect().bottom - 36);
				if (this.fabViewArea.offsetHeight > safeMax) {
					this.fabViewArea.setCssStyles({ height: `${safeMax}px` });
					this.plugin.settings.fabViewHeight = safeMax;
					void this.plugin.saveSettings();
				}
			});
		}

		setView(this.plugin, "floating-action-button");

		this.plugin.chatHistory
			.load(filePath)
			.then(({ meta, messages, toolCallsByTurn, skillsByTurn, modelsByTurn }) => {
				this.chatContainer!.resetChat();
				this.chatContainer!.setToolCallsByTurn(toolCallsByTurn);
				this.chatContainer!.setSkillsByTurn(skillsByTurn);
				this.chatContainer!.setModelsByTurn(modelsByTurn);
				this.chatContainer!.messageStore.setMessages(messages);
				void this.chatContainer!.generateIMLikeMessages(messages);

				this.fabChatHistoryContainer!.hide();
				this.fabChatContainerDiv!.show();
				this.fabChatContainerDiv!.querySelector(".messages-div")?.scroll(0, 9999);

				// Restore model settings from the file metadata
				if (meta.model && models[meta.model]) {
					const m = models[meta.model];
					this.plugin.settings[settingType].model = meta.model;
					this.plugin.settings[settingType].modelName = meta.model;
					this.plugin.settings[settingType].modelType = m.type;
					this.plugin.settings[settingType].modelEndpoint = m.endpoint;
					this.plugin.settings[settingType].endpointURL = m.url;
				}

				// Restore agent mode from the saved chat so the dropdown reflects
				// the model/assistant used in this conversation (not the current default).
				this.chatContainer!.isObsidianAgent = !!meta.agent;

				setHistoryFilePath(this.plugin, "floating-action-button", filePath);
				this.chatContainer!.currentHistoryFilePath = filePath;
				this.chatContainer!.restoreProjectFromChat(filePath, meta.project);

				void this.plugin.saveSettings();

				this.fabHeader!.setHeader(this.plugin.settings[settingType].modelName);
				this.fabHeader!.resetHistoryButton();
				this.fabHeader!.setTitle(meta.title ?? filePath);
				this.fabHeader!.showTitle();

				// Sync the model dropdown to reflect the restored settings/agent mode.
				this.chatContainer!.syncModelDropdown();
			})
			.catch((e) => {
				logger.error("[FAB] Failed to load chat file:", e);
				new Notice("Failed to load conversation.");
			});
	}

	removeFab() {
		this.chatContainer?.destroy();
		this.chatContainer = null;
		this.fabHeader = null;
		this.fabChatContainerDiv = null;
		this.fabChatHistoryContainer = null;
		this.fabViewArea = null;
		// Remove the element we mounted (it may live in a different window than
		// the currently active one); fall back to a lookup only for elements
		// left over from a previous plugin load.
		this.fabContainerEl?.remove();
		this.fabContainerEl = null;
		const FAB = activeDocument.getElementById("_floating-action-button");
		if (FAB) {
			FAB.remove();
		}
	}

	regenerateFAB() {
		this.removeFab();
		this.generateFAB();
	}
}
