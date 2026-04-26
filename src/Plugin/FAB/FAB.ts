import { ChatContainer } from "Plugin/Components/ChatContainer";
import { Header } from "Plugin/Components/Header";
import { HistoryContainer } from "Plugin/Components/HistoryContainer";
import { SettingsContainer } from "Plugin/Components/SettingsContainer";
import LLMPlugin from "main";
import { ButtonComponent } from "obsidian";
import { classNames } from "utils/classNames";
import { getViewInfo, setView } from "utils/utils";

const ROOT_WORKSPACE_CLASS = ".mod-vertical.mod-root";

export class FAB {
	plugin: LLMPlugin;
	private chatContainer: ChatContainer | null = null;

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
			this.plugin.saveSettings();
		});
		fabContainer.setAttribute("class", `floating-action-button`);
		fabContainer.setAttribute("id", "_floating-action-button");
		const viewArea = fabContainer.createDiv();
		viewArea.addClass("fab-view-area");

		// Set properties independently so they never clobber each other.
		// setAttr("style", ...) is intentionally avoided — it writes the whole
		// attribute string atomically and then changing one property (display)
		// later can race with or lose the other (height).
		const savedHeight = this.plugin.settings.fabViewHeight ?? 600;
		viewArea.style.display = "none";
		viewArea.style.height = `${savedHeight}px`;

		const header = new Header(this.plugin, "floating-action-button");
		this.chatContainer = new ChatContainer(
			this.plugin,
			"floating-action-button",
			this.plugin.conversationRegistry
		);
		const chatContainer = this.chatContainer;
		const historyContainer = new HistoryContainer(
			this.plugin,
			"floating-action-button"
		);
		const settingsContainer = new SettingsContainer(
			this.plugin,
			"floating-action-button"
		);

		// Resize handle lives directly on viewArea (outside contentArea) so it
		// can straddle the top border with a negative top offset. overflow:hidden
		// is on contentArea instead, keeping it off viewArea so the handle isn't
		// clipped.
		const resizeHandle = viewArea.createDiv();
		resizeHandle.addClass("fab-resize-handle");

		// All scrollable/clipped content goes in contentArea, which carries
		// overflow:hidden so the resize handle is unaffected.
		const contentArea = viewArea.createDiv();
		contentArea.addClass("fab-content-area");

		const lineBreak = contentArea.createDiv();
		const chatContainerDiv = contentArea.createDiv();
		const chatHistoryContainer = contentArea.createDiv();
		const settingsContainerDiv = contentArea.createDiv();
		header.generateHeader(
			contentArea,
			chatContainerDiv,
			chatHistoryContainer,
			settingsContainerDiv,
			chatContainer,
			historyContainer,
			settingsContainer
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
				viewArea.style.height = `${newHeight}px`;
			};

			const onPointerUp = () => {
				resizeHandle.releasePointerCapture(e.pointerId);
				viewArea.removeClass("is-resizing");
				resizeHandle.removeEventListener("pointermove", onPointerMove);
				resizeHandle.removeEventListener("pointerup", onPointerUp);
				// Persist the new height
				this.plugin.settings.fabViewHeight = viewArea.offsetHeight;
				this.plugin.saveSettings();
			};

			resizeHandle.addEventListener("pointermove", onPointerMove);
			resizeHandle.addEventListener("pointerup", onPointerUp);
		});

		let history = this.plugin.settings.promptHistory;

		settingsContainerDiv.setAttr("style", "display: none");
		settingsContainerDiv.addClass("fab-settings-container", "llm-flex");
		chatHistoryContainer.setAttr("style", "display: none");
		chatHistoryContainer.addClass("fab-chat-history-container", "llm-flex");
		lineBreak.className =
			classNames["floating-action-button"]["title-border"];
		chatContainerDiv.addClass("fab-chat-container", "llm-flex");

		chatContainer.generateChatContainer(chatContainerDiv, header);
		historyContainer.generateHistoryContainer(
			chatHistoryContainer,
			history,
			chatContainerDiv,
			chatContainer,
			header
		);
		settingsContainer.generateSettingsContainer(
			settingsContainerDiv,
			header,
			() => chatContainer.syncChips()
		);

		let button = new ButtonComponent(fabContainer);
		button
			.setIcon("bot-message-square")
			.setClass("buttonItem")
			.onClick(() => {
				if (viewArea.style.display === "none") {
					viewArea.style.display = "flex";
					// Clamp any persisted oversized height after the element is
					// visible and laid out so getBoundingClientRect() is accurate.
					requestAnimationFrame(() => {
						const safeMax = Math.max(
							360,
							viewArea.getBoundingClientRect().bottom - 36
						);
						if (viewArea.offsetHeight > safeMax) {
							viewArea.style.height = `${safeMax}px`;
							this.plugin.settings.fabViewHeight = safeMax;
							this.plugin.saveSettings();
						}
					});
				} else {
					viewArea.style.display = "none";
				}
			});

		document.body
			.querySelector(ROOT_WORKSPACE_CLASS)
			?.insertAdjacentElement("afterbegin", fabContainer);
	}

	removeFab() {
		this.chatContainer?.destroy();
		this.chatContainer = null;
		const FAB = document.getElementById("_floating-action-button");
		if (FAB) {
			FAB.remove();
		}
	}

	regenerateFAB() {
		this.removeFab();
		this.generateFAB();
	}
}
