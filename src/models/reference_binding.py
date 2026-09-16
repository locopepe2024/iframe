"""Bind display names to ordered attachments without exposing signed URLs in text."""
import mimetypes
import re
from urllib.parse import unquote, urlsplit


def media_kind(reference: str) -> str:
    mime = mimetypes.guess_type(unquote(urlsplit(reference).path))[0] or ""
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    if mime.startswith("image/"):
        return "image"
    raise ValueError("Cannot determine reference media type; reselect an image, video or audio file")


def bind_reference_names(prompt: str, labels: list[str]) -> str:
    positions: dict[str, list[int]] = {}
    for index, label in enumerate(labels, 1):
        if label:
            positions.setdefault(label, []).append(index)
    if not positions:
        return prompt
    pattern = r"@(" + "|".join(re.escape(name) for name in sorted(positions, key=len, reverse=True)) + r")(?=$|[\s，。！？、,.!?;；:：\u3400-\u9fff])"
    def replace(match):
        indices = positions[match[1]]
        if len(indices) != 1:
            raise ValueError("Referenced materials have duplicate names; use explicit @1, @2 indices")
        return "@" + str(indices[0])
    return re.sub(pattern, replace, prompt)
