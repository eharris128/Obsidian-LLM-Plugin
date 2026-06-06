import { App, ButtonComponent, Menu, Modal, Notice, TFile, setIcon } from "obsidian";
import LLMPlugin from "main";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

// ─── Rename Modal ─────────────────────────────────────────────────────────────

/** Simple single-field modal for renaming a chat conversation. */
export class RenameModal extends Modal {
	private currentTitle: string;
	private onRename: (newTitle: string) => void;

	constructor(app: App, currentTitle: string, onRename: (newTitle: string) => void) {
		super(app);
		this.currentTitle = currentTitle;
		this.onRename = onRename;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Rename chat" });

		const input = contentEl.createEl("input", { cls: "llm-rename-input" });
		(input).type = "text";
		(input).value = this.currentTitle;

		// Pre-select the text so the user can start typing immediately.
		requestAnimationFrame(() => (input).select());

		const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

		new ButtonComponent(buttonRow)
			.setButtonText("Cancel")
			.onClick(() => this.close());

		const doRename = () => {
			const newTitle = ((input).value ?? "").trim();
			if (!newTitle) {
				new Notice("Title must not be empty.");
				return;
			}
			this.close();
			this.onRename(newTitle);
		};

		new ButtonComponent(buttonRow)
			.setButtonText("Rename")
			.setCta()
			.onClick(doRename);

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") doRename();
			if (e.key === "Escape") this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ─── Chat Row Menu ────────────────────────────────────────────────────────────

/**
 * Attaches a three-dot (⋯) context-menu button to a chat-list row.
 * Called by ChatsView and ChatsSidebar for every rendered row.
 *
 * The button is appended into `flairOuter` alongside the date stamp.
 * It is hidden by default and revealed on row-hover via CSS
 * (.llm-chats-row-menu-btn visibility rules in styles.css).
 *
 * Menu options:
 *  • Open in  → Tab / Sidebar / FAB / Popover
 *  • Move to project (submenu)
 *  • Rename
 *  • Delete
 *
 * @param itemSelf   The .tree-item-self element (the hoverable row)
 * @param flairOuter The .tree-item-flair-outer element (right edge of the row)
 * @param file       TFile for this conversation
 * @param plugin     LLMPlugin instance
 * @param onRefresh  Called after any mutation so the list re-renders
 */
export function attachChatRowMenu(
	itemSelf: HTMLElement,
	flairOuter: HTMLElement,
	file: TFile,
	plugin: LLMPlugin,
	onRefresh: () => void,
): void {
	const menuBtn = flairOuter.createDiv({
		cls: "llm-chats-row-menu-btn clickable-icon",
	});
	setIcon(menuBtn, "ellipsis");
	menuBtn.setAttribute("aria-label", "Chat options");
	menuBtn.setAttribute("tabindex", "0");

	const openMenu = (e: MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();

		const title =
			(plugin.app.metadataCache.getFileCache(file)?.frontmatter
				?.title as string | undefined) ?? file.basename;

		const currentProjectId = detectProjectId(file.path, plugin);

		const menu = new Menu();

		// ── Open in ────────────────────────────────────────────────────────────
		menu.addItem((item) =>
			item
				.setTitle("Open in tab")
				.setIcon("layout-panel-top")
				.onClick(() => void plugin.openChatFileInWidget(file.path))
		);

		menu.addItem((item) =>
			item
				.setTitle("Open in sidebar")
				.setIcon("layout-sidebar-right")
				.onClick(() => void plugin.openChatFileInSidebar(file.path))
		);

		menu.addItem((item) =>
			item
				.setTitle("Open in FAB")
				.setIcon("bot-message-square")
				.onClick(() => plugin.openChatFileInFAB(file.path))
		);

		menu.addItem((item) =>
			item
				.setTitle("Open in popover")
				.setIcon("message-square")
				.onClick(() => plugin.openChatFileInPopover(file.path))
		);

		menu.addSeparator();

		// ── Move to project ────────────────────────────────────────────────────
		const projects = plugin.projectManager?.getProjects() ?? [];
		menu.addItem((item) => {
			item.setTitle("Move to project").setIcon("folder-input");
			const submenu = (item as any).setSubmenu() as Menu;

			// "No project" — move back to the default chat folder
			submenu.addItem((si) =>
				si
					.setTitle("No project")
					.setIcon("x-circle")
					.setChecked(!currentProjectId)
					.onClick(async () => {
						if (currentProjectId) {
							try {
								await plugin.chatHistory.moveToFolder(
									file.path,
									plugin.chatHistory.folder,
									undefined
								);
								onRefresh();
							} catch (err) {
								console.error("[ChatRowMenu] Failed to remove from project:", err);
								new Notice("Failed to move conversation.");
							}
						}
					})
			);

			if (projects.length > 0) {
				submenu.addSeparator();
				for (const project of projects) {
					submenu.addItem((si) =>
						si
							.setTitle(project.name)
							.setIcon("box")
							.setChecked(project.id === currentProjectId)
							.onClick(async () => {
								if (project.id === currentProjectId) return; // already there
								try {
									await plugin.chatHistory.moveToFolder(
										file.path,
										plugin.chatHistory.folderForProject(project.id),
										project.name
									);
									onRefresh();
								} catch (err) {
									console.error("[ChatRowMenu] Failed to move to project:", err);
									new Notice("Failed to move conversation.");
								}
							})
					);
				}
			} else {
				submenu.addItem((si) =>
					si.setTitle("No projects yet").setDisabled(true)
				);
			}
		});

		menu.addSeparator();

		// ── Rename ─────────────────────────────────────────────────────────────
		menu.addItem((item) =>
			item
				.setTitle("Rename")
				.setIcon("pencil")
				.onClick(() => {
					new RenameModal(plugin.app, title, async (newTitle) => {
						try {
							await plugin.chatHistory.rename(file.path, newTitle);
							onRefresh();
						} catch (err) {
							console.error("[ChatRowMenu] Failed to rename chat:", err);
							new Notice("Failed to rename conversation.");
						}
					}).open();
				})
		);

		// ── Delete ─────────────────────────────────────────────────────────────
		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash")
				.setWarning(true)
				.onClick(() => {
					new ConfirmDeleteModal(plugin.app, async () => {
						try {
							await plugin.chatHistory.delete(file.path);
							onRefresh();
						} catch (err) {
							console.error("[ChatRowMenu] Failed to delete chat:", err);
							new Notice("Failed to delete conversation.");
						}
					}).open();
				})
		);

		menu.showAtMouseEvent(e);
	};

	menuBtn.addEventListener("click", openMenu);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detects the project id a chat file currently belongs to, if any.
 * Checks file path first (Projects/<id>/chats/<file>), then falls back
 * to `project` frontmatter.
 */
function detectProjectId(filePath: string, plugin: LLMPlugin): string | null {
	const projectsFolder = plugin.projectsFolder + "/";
	if (filePath.startsWith(projectsFolder)) {
		const relative = filePath.slice(projectsFolder.length);
		const parts = relative.split("/");
		// Projects/<id>/chats/<file>.md
		if (parts.length >= 3 && parts[1] === "chats") return parts[0];
	}
	return null;
}
