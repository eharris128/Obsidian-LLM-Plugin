/**
 * TranscribeCommand — Feature 2: "Transcribe audio file"
 *
 * Opens a system file picker, reads the selected audio file, posts it to
 * WhisperService, and writes a transcription note to the configured output folder.
 */

import { Notice, Platform } from "obsidian";
import type LLMPlugin from "main";
import { WhisperService, SUPPORTED_AUDIO_EXTENSIONS } from "./WhisperService";

// Module-level guard: prevents the dialog from being opened twice concurrently.
// Electron's remote.dialog can fire its callback more than once in some edge
// cases, which would otherwise create two identical transcription notes.
let _transcribing = false;

export async function transcribeAudioFile(plugin: LLMPlugin): Promise<void> {
	if (_transcribing) return;
	_transcribing = true;

	if (!Platform.isDesktop) {
		_transcribing = false;
		new Notice("Audio file transcription is only available on desktop.");
		return;
	}

	try {
		const ws = plugin.settings.whisperSettings;

		// ── Ensure a WhisperService is available ─────────────────────────────
		if (!plugin.whisperService) {
			plugin.initWhisperService();
		}
		if (!plugin.whisperService) {
			new Notice("Whisper is not enabled. Enable it in Settings → Transcription.");
			return;
		}

		// ── Open system file picker ──────────────────────────────────────────
		// electron is an external module in Obsidian's Electron environment;
		// we use `any` to avoid requiring @types/electron in the project.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { remote } = require("electron") as any;

		const result = await remote.dialog.showOpenDialog({
			title:           "Select audio file to transcribe",
			defaultPath:     ws.lastPickerDirectory || undefined,
			buttonLabel:     "Transcribe",
			filters: [
				{
					name:       "Audio files",
					extensions: SUPPORTED_AUDIO_EXTENSIONS,
				},
			],
			properties: ["openFile"],
		});

		if (result.canceled || result.filePaths.length === 0) return;

		const filePath = result.filePaths[0];
		const path     = require("path") as typeof import("path");

		// Persist the last-used directory
		plugin.settings.whisperSettings.lastPickerDirectory = path.dirname(filePath);
		plugin.saveSettings();

		const filename = path.basename(filePath, path.extname(filePath));

		// ── Transcribe ───────────────────────────────────────────────────────
		const notice = new Notice(`Transcribing ${path.basename(filePath)}…`, 0);
		let result2: Awaited<ReturnType<WhisperService["transcribeFilePath"]>>;
		try {
			result2 = await plugin.whisperService.transcribeFilePath(filePath);
		} catch (err) {
			notice.hide();
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("not reachable") || msg.includes("ECONNREFUSED")) {
				new Notice("Whisper server not reachable. Is whisper-server.py running?", 6000);
			} else if (msg.includes("Could not read") || msg.includes("ENOENT")) {
				new Notice("Could not read file — is the drive connected?", 6000);
			} else {
				new Notice(`Transcription failed: ${msg}`, 6000);
			}
			return;
		}
		notice.hide();

		// ── Determine output model label ─────────────────────────────────────
		const modelLabel =
			ws.backend === "openai"
				? "whisper-1 (OpenAI)"
				: ws.whisperModel;

		// ── Build note content ───────────────────────────────────────────────
		const noteContent = WhisperService.buildNoteContent({
			filename:          filename,
			sourcePath:        filePath,
			result:            result2,
			includeTimestamps: ws.includeTimestamps,
			model:             modelLabel,
		});

		// ── Write note to vault ──────────────────────────────────────────────
		const outputFolder = ws.outputFolder || "Transcripts";
		const adapter      = plugin.app.vault.adapter;

		// Ensure output folder exists
		const folderExists = await adapter.exists(outputFolder);
		if (!folderExists) {
			const { createFolderOrPrompt } = await import("./TranscribeUtils");
			const created = await createFolderOrPrompt(plugin, outputFolder);
			if (!created) return;
		}

		// Build a unique note path (append number if name is taken)
		const notePath = await buildUniqueNotePath(plugin, outputFolder, filename);

		await adapter.write(notePath, noteContent);

		// ── Success feedback ─────────────────────────────────────────────────
		const duration = WhisperService.formatDuration(result2.durationSeconds);
		new Notice(
			`Transcription saved: ${path.basename(notePath)} (${duration})`,
			5000,
		);

		// Auto-open note if configured
		if (ws.autoOpenNote) {
			const tfile = plugin.app.vault.getAbstractFileByPath(notePath);
			if (tfile) {
				await plugin.app.workspace.getLeaf(false).openFile(tfile as import("obsidian").TFile);
			}
		}
	} finally {
		// Always release the lock so subsequent invocations can proceed
		_transcribing = false;
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function buildUniqueNotePath(
	plugin:       LLMPlugin,
	folder:       string,
	baseFilename: string,
): Promise<string> {
	const adapter = plugin.app.vault.adapter;
	let candidate = `${folder}/${baseFilename}.md`;
	if (!(await adapter.exists(candidate))) return candidate;

	let i = 2;
	while (await adapter.exists(`${folder}/${baseFilename} ${i}.md`)) i++;
	return `${folder}/${baseFilename} ${i}.md`;
}
