/**
 * WhisperService — isolated speech-to-text service layer.
 *
 * Supports two backends:
 *   - "openai"  : OpenAI /audio/transcriptions endpoint (whisper-1 model).
 *   - "sidecar" : Local Python whisper-server.py (faster-whisper, fully private).
 *
 * Both backends share the same external interface. Callers never need to know
 * which backend is active.
 */

import OpenAI from "openai";
import { Platform, requestUrl } from "obsidian";
import type LLMPlugin from "main";
import { getErrorMessage, getErrorName } from "utils/errorUtils";

// ── Shared result type ──────────────────────────────────────────────────────

export type TranscriptSegment = {
	start: number;  // seconds
	end: number;    // seconds
	text: string;
};

export type TranscriptResult = {
	transcript: string;
	language: string;
	durationSeconds: number;
	segments: TranscriptSegment[];
};

// ── Health-check response ───────────────────────────────────────────────────

export type WhisperHealthResult = {
	ok: boolean;
	model?: string;
	error?: string;
};

// ── Supported audio MIME types / extensions ─────────────────────────────────

export const SUPPORTED_AUDIO_EXTENSIONS = [
	"mp3", "m4a", "wav", "ogg", "flac", "opus", "aac", "mp4", "webm",
];

export const SUPPORTED_AUDIO_MIME_TYPES: Record<string, string> = {
	mp3:  "audio/mpeg",
	m4a:  "audio/mp4",
	wav:  "audio/wav",
	ogg:  "audio/ogg",
	flac: "audio/flac",
	opus: "audio/ogg; codecs=opus",
	aac:  "audio/aac",
	mp4:  "audio/mp4",
	webm: "audio/webm",
};

// ── WhisperService ──────────────────────────────────────────────────────────

export class WhisperService {
	constructor(private plugin: LLMPlugin) {}

	// ── Public API ────────────────────────────────────────────────────────

	/**
	 * Transcribe an audio Blob (e.g. from MediaRecorder for voice input).
	 *
	 * @param audioBlob  The recorded audio blob.
	 * @param mimeType   The MIME type reported by MediaRecorder (e.g. "audio/webm").
	 * @param filename   Optional filename hint (used by OpenAI backend for format detection).
	 */
	async transcribeBlob(
		audioBlob: Blob,
		mimeType: string,
		filename = "recording.webm",
	): Promise<TranscriptResult> {
		const { backend } = this.plugin.settings.whisperSettings;
		if (backend === "openai") {
			return this.transcribeBlobOpenAI(audioBlob, filename);
		}
		return this.transcribeBlobSidecar(audioBlob, mimeType, filename);
	}

	/**
	 * Transcribe an audio file at an absolute filesystem path (Feature 2).
	 *
	 * @param absolutePath  Absolute path to the audio file on disk.
	 */
	async transcribeFilePath(absolutePath: string): Promise<TranscriptResult> {
		if (!Platform.isDesktop) throw new Error("File transcription is only available on desktop.");
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node builtin; desktop-only lazy require behind the function-start Platform.isDesktop guard
		const path = require("path") as typeof import("path");
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node builtin; desktop-only lazy require behind the function-start Platform.isDesktop guard
		const fs   = require("fs")   as typeof import("fs");

		const ext      = path.extname(absolutePath).replace(".", "").toLowerCase();
		const mimeType = SUPPORTED_AUDIO_MIME_TYPES[ext] ?? "audio/mpeg";
		const filename = path.basename(absolutePath);

		const buffer = fs.readFileSync(absolutePath);
		const blob   = new Blob([buffer], { type: mimeType });

		return this.transcribeBlob(blob, mimeType, filename);
	}

	/**
	 * Ping the backend to verify it is reachable.
	 * For the OpenAI backend this validates that the API key works by listing models.
	 * For the sidecar backend it calls GET /health.
	 */
	async checkHealth(): Promise<WhisperHealthResult> {
		const { backend } = this.plugin.settings.whisperSettings;
		try {
			if (backend === "openai") {
				return this.healthOpenAI();
			}
			return this.healthSidecar();
		} catch (err) {
			return { ok: false, error: String(err) };
		}
	}

	// ── OpenAI backend ────────────────────────────────────────────────────

	private buildOpenAIClient(): OpenAI {
		return new OpenAI({
			apiKey: this.plugin.settings.openAIAPIKey,
			dangerouslyAllowBrowser: true,
		});
	}

	private async transcribeBlobOpenAI(
		audioBlob: Blob,
		filename: string,
	): Promise<TranscriptResult> {
		const { language } = this.plugin.settings.whisperSettings;
		const openai = this.buildOpenAIClient();

		const file = new File([audioBlob], filename, { type: audioBlob.type });

		// verbose_json gives us segments and language info.
		const response = await openai.audio.transcriptions.create({
			file,
			model: "whisper-1",
			response_format: "verbose_json",
			...(language ? { language } : {}),
		});

		// OpenAI returns the verbose_json shape when response_format is "verbose_json"
		type VerboseJson = {
			text?: string;
			language?: string;
			duration?: number;
			segments?: Array<{ start?: number; end?: number; text?: string }>;
		};
		const raw = response as VerboseJson;
		const segments: TranscriptSegment[] = (raw.segments ?? []).map((s) => ({
			start: s.start ?? 0,
			end:   s.end   ?? 0,
			text:  (s.text ?? "").trim(),
		}));

		return {
			transcript:      (raw.text ?? "").trim(),
			language:        raw.language ?? language ?? "en",
			durationSeconds: raw.duration ?? 0,
			segments,
		};
	}

	private async healthOpenAI(): Promise<WhisperHealthResult> {
		const key = this.plugin.settings.openAIAPIKey;
		if (!key) {
			return { ok: false, error: "No OpenAI API key configured." };
		}
		// Lightweight check — just validate the key by listing models.
		const openai = this.buildOpenAIClient();
		await openai.models.list();
		return { ok: true, model: "whisper-1 (OpenAI)" };
	}

	// ── Sidecar backend ───────────────────────────────────────────────────

	private async transcribeBlobSidecar(
		audioBlob: Blob,
		mimeType: string,
		filename: string,
	): Promise<TranscriptResult> {
		const { sidecarHost, whisperModel, language, includeTimestamps } =
			this.plugin.settings.whisperSettings;

		// Build multipart/form-data manually since requestUrl doesn't accept FormData.
		// We use the browser's native fetch (available in Electron's renderer) instead.
		const formData = new FormData();
		formData.append("file", new File([audioBlob], filename, { type: mimeType }));
		formData.append("model", whisperModel);
		if (language) formData.append("language", language);
		formData.append("timestamps", String(includeTimestamps));

		// 60-second timeout — large files on slow hardware can take a while,
		// but we never want to hang indefinitely if the server is unresponsive.
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), 60_000);

		let response: Response;
		try {
			response = await fetch(`${sidecarHost}/transcribe`, {
				method: "POST",
				body:   formData,
				signal: controller.signal,
			});
		} catch (err) {
			if (getErrorName(err) === "AbortError") {
				throw new Error(
					"Transcription timed out after 60 s. " +
					"The server may still be loading the model — try again in a moment.",
					{ cause: err },
				);
			}
			throw new Error(
				`Whisper server not reachable. Is whisper-server.py running? (${getErrorMessage(err)})`,
				{ cause: err },
			);
		} finally {
			window.clearTimeout(timeout);
		}

		if (!response.ok) {
			const errText = await response.text().catch(() => response.statusText);
			throw new Error(`Transcription failed: ${errText}`);
		}

		const json = (await response.json()) as {
			transcript?: string;
			language?: string;
			duration_seconds?: number;
			segments?: Array<{ start?: number; end?: number; text?: string }>;
		};
		const segments: TranscriptSegment[] = (json.segments ?? []).map((s) => ({
			start: s.start ?? 0,
			end:   s.end   ?? 0,
			text:  (s.text ?? "").trim(),
		}));

		return {
			transcript:      (json.transcript ?? "").trim(),
			language:        json.language ?? language ?? "en",
			durationSeconds: json.duration_seconds ?? 0,
			segments,
		};
	}

	private async healthSidecar(): Promise<WhisperHealthResult> {
		const { sidecarHost } = this.plugin.settings.whisperSettings;
		try {
			const response = await requestUrl({
				url:    `${sidecarHost}/health`,
				method: "GET",
				throw: false,
			});
			if (response.status !== 200) {
				return {
					ok:    false,
					error: `Server responded with status ${response.status}`,
				};
			}
			const json = response.json;
			return { ok: true, model: json?.model ?? "unknown" };
		} catch {
			return {
				ok:    false,
				error: "Whisper server not reachable. Is whisper-server.py running?",
			};
		}
	}

	// ── Utility ───────────────────────────────────────────────────────────

	/**
	 * Format a TranscriptResult as a string suitable for inserting into the chat
	 * input field (plain transcript, no timestamps).
	 */
	static formatForChat(result: TranscriptResult): string {
		return result.transcript;
	}

	/**
	 * Format a TranscriptResult as markdown note body.
	 * If includeTimestamps is true, uses segment-level [MM:SS] markers.
	 */
	static formatForNote(
		result:            TranscriptResult,
		includeTimestamps: boolean,
	): string {
		if (!includeTimestamps || result.segments.length === 0) {
			return result.transcript;
		}

		return result.segments
			.map((seg) => {
				const mm  = Math.floor(seg.start / 60).toString().padStart(2, "0");
				const ss  = Math.floor(seg.start % 60).toString().padStart(2, "0");
				return `[${mm}:${ss}] ${seg.text}`;
			})
			.join("\n");
	}

	/**
	 * Build the YAML frontmatter + body for a transcription note.
	 */
	static buildNoteContent(params: {
		filename:          string;
		sourcePath:        string;
		result:            TranscriptResult;
		includeTimestamps: boolean;
		model:             string;
	}): string {
		const { filename, sourcePath, result, includeTimestamps, model } = params;
		const date     = new Date().toISOString().slice(0, 10);
		const duration = WhisperService.formatDuration(result.durationSeconds);
		const body     = WhisperService.formatForNote(result, includeTimestamps);

		return [
			"---",
			`title: "${filename}"`,
			`source: "${sourcePath}"`,
			`transcribed: ${date}`,
			`duration: "${duration}"`,
			`language: ${result.language}`,
			`model: ${model}`,
			"tags:",
			"  - transcription",
			"---",
			"",
			`# ${filename}`,
			"",
			body,
			"",
		].join("\n");
	}

	/** Format seconds as "HH:MM:SS" or "MM:SS" depending on length. */
	static formatDuration(seconds: number): string {
		const h  = Math.floor(seconds / 3600);
		const m  = Math.floor((seconds % 3600) / 60);
		const s  = Math.floor(seconds % 60);
		const mm = m.toString().padStart(2, "0");
		const ss = s.toString().padStart(2, "0");
		return h > 0
			? `${h}:${mm}:${ss}`
			: `${mm}:${ss}`;
	}
}
