"""Compile explicit Cast image mentions against ordered provider attachments."""

import re
from typing import Any, Dict, List, Tuple


TOKEN = re.compile(r"@\{([A-Za-z0-9_-]{1,120})\}")
PROVIDER_LABEL = re.compile(r"(?:<|\[)?\s*picture\s*\d+\s*(?:>|\])?", re.IGNORECASE)
MAX_ASSET_REFERENCES = 9


class InvalidAssetMention(ValueError):
    pass


def compile_asset_mentions(
    prompt: str,
    references: List[Dict[str, Any]],
) -> Tuple[str, List[Dict[str, Any]]]:
    """Return provider prompt and references ordered by first token occurrence."""
    value = str(prompt or "")
    by_id: Dict[str, Dict[str, Any]] = {}
    for reference in references:
        mention_id = str(reference.get("mention_id") or "").strip()
        if not mention_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", mention_id):
            raise InvalidAssetMention("reference.mention_id is invalid")
        if mention_id in by_id and by_id[mention_id] != reference:
            raise InvalidAssetMention("conflicting asset mention identity")
        by_id[mention_id] = reference

    ordered: List[Dict[str, Any]] = []
    positions: Dict[Tuple[str, str, str], int] = {}
    mentioned_ids = set()

    def replace(match: re.Match[str]) -> str:
        mention_id = match.group(1)
        reference = by_id.get(mention_id)
        if reference is None:
            raise InvalidAssetMention("prompt contains an unresolved asset mention")
        mentioned_ids.add(mention_id)
        identity = (reference["asset_type"], reference["asset_id"], reference["variant_id"])
        if identity not in positions:
            if len(ordered) >= MAX_ASSET_REFERENCES:
                raise InvalidAssetMention("image generation supports at most 9 referenced images")
            ordered.append(reference)
            positions[identity] = len(ordered)
        return f"<Picture {positions[identity]}>"

    compiled = TOKEN.sub(replace, value)
    remainder = TOKEN.sub("", value)
    if "@" in remainder:
        raise InvalidAssetMention("prompt contains an unresolved @ reference")
    if PROVIDER_LABEL.search(remainder):
        raise InvalidAssetMention("provider picture labels must be inserted with @ from the asset library")
    if set(by_id) != mentioned_ids:
        raise InvalidAssetMention("reference payload contains an image that is not mentioned in the prompt")
    return compiled, ordered
