"""Decode a complete model JSON object without repairing or selecting fragments."""
import json
from typing import Any


def parse_model_json_object(content: str) -> dict[str, Any]:
    """Allow introductory prose/code fences, but reject incomplete or extra JSON."""
    content = content.strip()
    start = content.find("{")
    if start < 0 or content.startswith("["):
        raise ValueError("Expected one JSON object")
    value, end = json.JSONDecoder().raw_decode(content, start)
    if content[end:].strip() not in ("", "```"):
        raise ValueError("Unexpected content after JSON object")
    return value
