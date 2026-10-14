"""Opt-in capture of outbound LLM messages for short diagnostic sessions."""

import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)
_URL = re.compile(r"https?://[^\s\"'<>]+")
_DATA_URI = re.compile(r"data:[^\s\"'<>]+")
_SENSITIVE_KEYS = {"api_key", "authorization", "access_token", "secret", "password", "data"}


def _safe_content(value: Any) -> Any:
    if isinstance(value, str):
        return _URL.sub("[url omitted]", _DATA_URI.sub("[data-uri omitted]", value))
    if isinstance(value, list):
        return [_safe_content(item) for item in value]
    if isinstance(value, dict):
        return {
            key: "[redacted]" if key.lower() in _SENSITIVE_KEYS else _safe_content(item)
            for key, item in value.items()
        }
    return value


def record_llm_request(stage: str, model: str, messages: list[dict], **options: Any) -> None:
    """Record text and multimodal structure without media bytes or credentials."""
    if os.getenv("IFRAME_LLM_REQUEST_DEBUG") != "1":
        return
    try:
        directory = Path(os.getenv("LUMENX_OUTPUT_DIR", "output")) / "diagnostics"
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        entries = []
        for message in messages:
            content = message.get("content", "")
            entries.append({
                "role": message.get("role"),
                "content_chars": len(content) if isinstance(content, str) else len(json.dumps(content, ensure_ascii=False)),
                "image_count": sum(part.get("type") == "image_url" for part in content if isinstance(part, dict)) if isinstance(content, list) else 0,
                "content": _safe_content(content),
            })
        record = {
            "request_id": uuid.uuid4().hex,
            "timestamp": time.time(),
            "stage": stage,
            "model": model,
            "messages": entries,
            "options": _safe_content(options),
        }
        flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(directory / "llm-requests.jsonl", flags, 0o600)
        try:
            os.fchmod(fd, 0o600)
            os.write(fd, (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
        finally:
            os.close(fd)
    except (OSError, TypeError, ValueError):
        logger.warning("LLM request diagnostic could not be written: stage=%s", stage)
