"""Offline speech-to-text + keyword extract.

Live ranking never waits on this. The recorder can send a cheap browser
draft transcript; this worker later replaces it with a real transcript.

Set WHISPER_MODEL (e.g. tiny/base) to enable faster-whisper. Leave it
unset in local/CI so the app stays light. Java is not used here.
"""

from __future__ import annotations

import os
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlparse

from textsim import keywords_from_text

MAX_AUDIO_BYTES = 42 * 1024 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def allowed_media_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    allowed: set[str] = set()
    endpoint = os.environ.get("S3_ENDPOINT", "")
    if endpoint:
        eh = urlparse(endpoint).hostname
        if eh:
            allowed.add(eh.lower())
    extra = os.environ.get("TRANSCRIBE_URL_HOSTS", "minio,localhost,127.0.0.1")
    allowed.update(h.strip().lower() for h in extra.split(",") if h.strip())
    return host in allowed


def transcribe_payload(
    caption: str = "",
    draft_transcript: str = "",
    download_url: str | None = None,
) -> dict[str, list[str] | str]:
    text = (draft_transcript or "").strip()
    if download_url and os.environ.get("WHISPER_MODEL") and allowed_media_url(download_url):
        whisper_text = _whisper(download_url)
        if whisper_text:
            text = whisper_text
    if not text:
        text = (caption or "").strip()
    return {"transcript": text, "terms": keywords_from_text(text)}


def _whisper(download_url: str) -> str:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        return ""
    model_name = os.environ.get("WHISPER_MODEL", "tiny")
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=True) as tmp:
        req = urllib.request.Request(download_url, method="GET")
        try:
            with _opener.open(req, timeout=20) as src:
                data = src.read(MAX_AUDIO_BYTES + 1)
        except (urllib.error.URLError, OSError, ValueError):
            return ""
        if len(data) > MAX_AUDIO_BYTES:
            return ""
        tmp.write(data)
        tmp.flush()
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, _ = model.transcribe(tmp.name, beam_size=1)
        return " ".join(seg.text.strip() for seg in segments if seg.text).strip()
