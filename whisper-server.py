#!/usr/bin/env python3
"""
whisper-server.py — Local Whisper sidecar for the Obsidian LLM Plugin.

One-time setup:
    pip install fastapi uvicorn faster-whisper python-multipart

Run:
    python whisper-server.py                    # uses "medium.en" model, port 8765
    python whisper-server.py --model small      # choose a different model
    python whisper-server.py --port 9000        # different port

Models (downloaded automatically to ~/.cache/huggingface/ on first use):
    tiny, tiny.en, base, base.en, small, small.en,
    medium, medium.en, large-v2, large-v3

All audio stays on your machine — nothing is sent to the internet.
"""

import argparse
import io
import os
import time
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

# ── Argument parsing ────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description="Whisper sidecar server")
parser.add_argument(
    "--model", default="medium.en",
    help="Whisper model to load (default: medium.en)"
)
parser.add_argument(
    "--port", type=int, default=8765,
    help="Port to listen on (default: 8765)"
)
parser.add_argument(
    "--device", default="auto",
    choices=["auto", "cpu", "cuda"],
    help="Compute device (default: auto)"
)
parser.add_argument(
    "--compute-type", default="auto",
    help="Quantization type: int8, float16, float32, etc. (default: auto)"
)
args = parser.parse_args()

# ── Model loading ───────────────────────────────────────────────────────────

def _cuda_available() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


print(f"[whisper-server] Loading model '{args.model}' …")
print("[whisper-server] First run will download the model (~MB to ~GB depending on size).")

device       = args.device if args.device != "auto" else ("cuda" if _cuda_available() else "cpu")
compute_type = args.compute_type if args.compute_type != "auto" else ("int8" if device == "cpu" else "float16")

model = WhisperModel(args.model, device=device, compute_type=compute_type)
print(f"[whisper-server] Model loaded on {device} ({compute_type}). Listening on :{args.port}")

# ── FastAPI app ─────────────────────────────────────────────────────────────

app = FastAPI(title="Whisper Sidecar", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

SUPPORTED_EXTENSIONS = {
    "mp3", "m4a", "wav", "ogg", "flac", "opus", "aac", "mp4", "webm",
}

# ── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Return server status and loaded model name."""
    return {"status": "ok", "model": args.model, "device": device}


@app.post("/transcribe")
async def transcribe(
    file:       UploadFile = File(...),
    language:   Optional[str] = Form(None),
    timestamps: bool = Form(False),
):
    """
    Transcribe an audio file.

    Form fields:
        file        — audio binary (required)
        language    — ISO language code e.g. "en", "ja" (optional; omit for auto-detect)
        timestamps  — "true" | "false" — whether to include segment timestamps (optional)

    Returns JSON:
        {
            "transcript":        "Full transcript text...",
            "language":          "en",
            "duration_seconds":  312.4,
            "segments": [
                { "start": 0.0, "end": 4.2, "text": "First sentence." },
                ...
            ]
        }
    """
    # Validate format
    filename  = file.filename or "audio"
    extension = os.path.splitext(filename)[1].lstrip(".").lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported format: .{extension}. "
                   f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    # Read into memory
    audio_bytes = await file.read()
    audio_buf   = io.BytesIO(audio_bytes)

    # Transcribe
    t0 = time.monotonic()
    segments_iter, info = model.transcribe(
        audio_buf,
        language=language or None,
        word_timestamps=False,
        vad_filter=True,
    )

    segments_list = []
    full_text_parts = []
    for seg in segments_iter:
        text = seg.text.strip()
        full_text_parts.append(text)
        if timestamps:
            segments_list.append({
                "start": round(seg.start, 3),
                "end":   round(seg.end,   3),
                "text":  text,
            })

    elapsed = time.monotonic() - t0

    return {
        "transcript":       " ".join(full_text_parts),
        "language":         info.language,
        "duration_seconds": round(info.duration, 2),
        "segments":         segments_list,
        "processing_time":  round(elapsed, 2),
    }


# ── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")
