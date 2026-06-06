---
paths:
  - "src/Whisper/**"
  - "whisper-server.py"
---

# Whisper Transcription

Two speech-to-text features behind `whisperSettings.enabled`:

- **Voice input** — mic button in the chat toolbar (idle/recording/transcribing); `MediaRecorder` audio → `WhisperService`; transcript inserted into input (or auto-sent when `autoSend`).
- **File transcription → note** — "Transcribe audio file" command; Electron `remote.dialog` picker → Node `fs` read → `WhisperService` → markdown note in `outputFolder`.

Backends (both in `src/Whisper/WhisperService.ts`): `"openai"` (`/audio/transcriptions`, whisper-1, uses `openAIAPIKey`) and `"sidecar"` (local Python `whisper-server.py`, faster-whisper; uses browser `fetch`+`FormData` — not `requestUrl`, sidecar needs multipart).

Key files: `WhisperService.ts`, `SidecarManager.ts` (detects python3/pip3, installs deps, starts/stops the sidecar; always instantiated as `plugin.sidecarManager`, `isServerOwned` true only when we spawned it), `TranscribeCommand.ts`, `TranscribeUtils.ts`, root-level `whisper-server.py` (FastAPI; `POST /transcribe`, `GET /health`).

Integration: `LLMPlugin.whisperService` is null when disabled — call `plugin.initWhisperService()` after toggling. `ChatContainer._triggerSend` closure (wired in `generateChatContainer`) lets voice auto-send fire the full send action. `ChatContainer.micButton` only exists when Whisper was enabled at container build time (CSS states `llm-mic-recording`, `llm-mic-transcribing`). `whisperSettings` is deep-merged in `loadSettings()`.

**Electron note:** `require("electron")` is cast as `any` — `@types/electron` is not installed; do not add a typed import.
