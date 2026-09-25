"""Version-pinned literal source evidence from existing structured assets."""

import hashlib
from typing import Dict, List, Optional

from fastapi import HTTPException

from .models import Script

DIRECTOR_FACT_CATEGORIES = {
    "characters",
    "relationships",
    "world_rules",
    "timeline",
    "events",
    "open_threads",
    "conflicts",
    "uncertainties",
}


def source_version(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def query_asset_mentions(
    script: Script,
    asset_kind: str,
    asset_id: str,
    expected_source_version: str,
    assets: Optional[Dict[str, List]] = None,
    limit: int = 20,
) -> dict:
    """Find literal mentions without interpreting them as story facts."""
    text = script.original_text or ""
    current_version = source_version(text)
    if expected_source_version != current_version:
        raise HTTPException(409, "Script text changed; refresh the source version")

    available = assets or {
        "character": script.characters,
        "scene": script.scenes,
        "prop": script.props,
    }
    if asset_kind not in ("character", "scene", "prop"):
        raise HTTPException(422, "Unsupported asset kind")
    items = available.get(asset_kind, [])
    asset = next((item for item in items if item.id == asset_id), None)
    if asset is None:
        raise HTTPException(404, "Asset not found")

    name = asset.name.strip()
    if not name:
        raise HTTPException(422, "Asset has no searchable name")
    matched_name = name
    variant_ambiguous = False
    if asset_kind == "character" and name not in text and asset.base_character_id:
        base = next((item for item in items if item.id == asset.base_character_id), None)
        if base and base.name.strip():
            matched_name = base.name.strip()
            variant_ambiguous = True

    mentions = []
    offset = 0
    while len(mentions) < limit:
        start = text.find(matched_name, offset)
        if start < 0:
            break
        end = start + len(matched_name)
        snippet_start = max(0, start - 100)
        snippet_end = min(len(text), end + 100)
        mentions.append({
            "start": start,
            "end": end,
            "snippet_start": snippet_start,
            "snippet_end": snippet_end,
            "snippet": text[snippet_start:snippet_end],
            "evidence_type": "literal_mention",
        })
        offset = end

    return {
        "project_id": script.id,
        "source_version": current_version,
        "source_version_kind": "content_hash",
        "asset_kind": asset_kind,
        "asset_id": asset_id,
        "asset_name": name,
        "matched_name": matched_name,
        "variant_ambiguous": variant_ambiguous,
        "mentions": mentions,
        "truncated": len(mentions) == limit and text.find(matched_name, offset) >= 0,
    }


def query_director_facts(
    script: Script,
    expected_source_revision: int,
    category: Optional[str] = None,
    subject: Optional[str] = None,
    limit: int = 50,
) -> dict:
    """Return confirmed Director canon entries without semantic retrieval.

    Entries remain evidence records: source refs and explicit status are
    preserved, while missing source bindings are surfaced as unbound rather
    than silently treated as current-script facts.
    """
    if expected_source_revision != script.source_revision:
        raise HTTPException(409, "Script source revision changed; refresh evidence")
    if category is not None and category not in DIRECTOR_FACT_CATEGORIES:
        raise HTTPException(422, "Unsupported Director fact category")
    profile = script.art_direction.director_profile if script.art_direction else None
    state = profile.canon_state if profile else {}
    categories = [category] if category else sorted(DIRECTOR_FACT_CATEGORIES)
    facts = []
    unbound_count = 0
    for current_category in categories:
        for item in state.get(current_category, []):
            if not isinstance(item, dict):
                continue
            item_subject = str(item.get("subject", ""))
            if subject and subject not in item_subject:
                continue
            bound_revision = item.get("source_revision")
            if bound_revision in (None, ""):
                unbound_count += 1
            elif int(bound_revision) != expected_source_revision:
                continue
            facts.append({
                "category": current_category,
                "fact": dict(item),
                "source_revision": bound_revision,
                "evidence_status": item.get("status", "uncertain"),
            })
            if len(facts) >= limit:
                break
        if len(facts) >= limit:
            break
    return {
        "project_id": script.id,
        "source_revision": expected_source_revision,
        "source_version": source_version(script.original_text),
        "facts": facts,
        "unbound_fact_count": unbound_count,
        "truncated": len(facts) >= limit,
    }


def query_script_fact_ledger(
    script: Script,
    source_revision: int,
    ledger_revision: Optional[int] = None,
    offset: int = 0,
    limit: int = 100,
) -> dict:
    """Read an archived, user-confirmed fact ledger with exact source quotes."""
    offset = max(0, int(offset))
    limit = max(1, min(int(limit), 100))
    requested_ledger_revision = ledger_revision if ledger_revision is not None else script.fact_ledger_revision
    ledger = next((
        revision for revision in script.fact_ledger_revisions
        if revision.revision == requested_ledger_revision
    ), None)
    if ledger is None and requested_ledger_revision == 0 and source_revision == script.source_revision:
        return {
            "project_id": script.id,
            "ledger_revision": 0,
            "source_revision": source_revision,
            "source_revision_id": f"source-r{source_revision}:{source_version(script.original_text)}",
            "source_version": source_version(script.original_text),
            "offset_unit": "unicode_codepoint_half_open",
            "facts": [],
            "offset": offset,
            "total_facts": 0,
            "truncated": False,
        }
    if ledger is None:
        raise HTTPException(404, "Fact ledger revision not found")
    if ledger.source_revision != source_revision:
        raise HTTPException(409, "Fact ledger is pinned to another source revision")
    source = next((
        item for item in script.source_revisions if item.revision == source_revision
    ), None)
    if source is None and source_revision == script.source_revision:
        source_text = script.original_text
        content_hash = source_version(source_text)
    elif source is None:
        raise HTTPException(404, "Script source revision not found")
    else:
        source_text = source.text
        content_hash = source.content_hash
        if source_version(source_text) != content_hash:
            raise HTTPException(409, "Stored source revision content hash is invalid")
    resolved_source_id = source.source_revision_id if source is not None else (
        f"source-r{source_revision}:{content_hash}"
    )
    if ledger.source_revision_id and ledger.source_revision_id != resolved_source_id:
        raise HTTPException(409, "Fact ledger source revision identity does not match its source")
    if any(
        fact.source_revision_id not in (None, resolved_source_id)
        for fact in ledger.facts
    ):
        raise HTTPException(409, "Fact ledger contains a source revision identity mismatch")

    facts = []
    selected_facts = ledger.facts[offset:offset + limit]
    for fact in selected_facts:
        spans = []
        for source_range in fact.source_ranges:
            if source_range.end > len(source_text):
                raise HTTPException(409, f"Fact {fact.fact_id} source range is invalid for its source revision")
            spans.append({
                "start": source_range.start,
                "end": source_range.end,
                "text": source_text[source_range.start:source_range.end],
            })
        facts.append({**fact.model_dump(), "evidence": spans})
    return {
        "project_id": script.id,
        "ledger_revision": ledger.revision,
        "source_revision": source_revision,
        "source_revision_id": resolved_source_id,
        "source_version": content_hash,
        "offset_unit": "unicode_codepoint_half_open",
        "facts": facts,
        "offset": offset,
        "total_facts": len(ledger.facts),
        "truncated": offset + len(selected_facts) < len(ledger.facts),
    }
