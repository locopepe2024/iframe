"""Versioned macro and detail review gates for source-frame motion analysis."""

import hashlib
import json

from fastapi import HTTPException

from .shot_review import timeline_key, validate_items


DETAIL_KINDS = {"foot", "body", "camera", "optics", "uncertainty"}
DECISIONS = {"pending", "accept", "edit", "reject", "unknown"}
SCREEN_FEET = {"screen_left", "screen_right", "unknown"}
ANATOMICAL_FEET = {"left", "right", "unknown"}
SUPPORT_STATES = {"supporting", "touching", "swinging", "airborne", "unknown"}
SOLE_CONTACTS = {"full_sole", "heel", "forefoot", "toe", "rolling", "none", "unknown"}


def digest(value):
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def source_binding(record):
    return {"source_fingerprint": record["source_fingerprint"],
            "analysis_id": record["analysis_id"], "timeline_key": timeline_key(record)}


def valid_macro(record, snapshot):
    return bool(snapshot and all(snapshot.get(key) == value for key, value in source_binding(record).items())
                and snapshot.get("macro_revision") == (record.get("shot_review") or {}).get("review_revision")
                and snapshot.get("digest") == digest({key: value for key, value in snapshot.items() if key != "digest"}))


def freeze_macro(record, expected_revision):
    review = record.get("shot_review") or {}
    if review.get("review_revision") != expected_revision or expected_revision < 1:
        raise HTTPException(409, "Macro review revision changed")
    if any(review.get(key) != value for key, value in source_binding(record).items()):
        raise HTTPException(409, "Macro review is stale")
    items = review.get("items")
    validate_items(items, record)
    if not items or any(item["decision"] == "pending" for item in items):
        raise HTTPException(409, "Macro review has pending decisions")
    shots = {shot["id"] for shot in record["timeline"]["shots"]}
    if not shots <= {item["shot_id"] for item in items}:
        raise HTTPException(409, "Macro review does not cover every shot")
    snapshot = {**source_binding(record), "macro_revision": expected_revision, "items": items}
    return {**snapshot, "digest": digest(snapshot)}


def detail_frames(record, shot_id):
    shot = next((row for row in record["timeline"]["shots"] if row["id"] == shot_id), None)
    if shot is None:
        raise HTTPException(422, "Detail references an unknown shot")
    return [number for number, pts in enumerate(record["analysis"]["frame_pts"], 1)
            if shot["start_pts"] <= pts < shot["end_pts"]]


def validate_detail_items(record, items):
    if not isinstance(items, list) or len(items) > 1000:
        raise HTTPException(422, "Invalid detail item list")
    ids = set()
    for item in items:
        if not isinstance(item, dict) or item.get("kind") not in DETAIL_KINDS or item.get("decision") not in DECISIONS:
            raise HTTPException(422, "Invalid detail item")
        ident = item.get("id")
        if not isinstance(ident, str) or not ident or len(ident) > 100 or ident in ids:
            raise HTTPException(422, "Detail IDs must be unique")
        ids.add(ident)
        frames = detail_frames(record, item.get("shot_id"))
        span = item.get("frame_span")
        evidence = item.get("evidence_frames")
        if (not frames or not isinstance(span, list) or len(span) != 2 or
                any(type(value) is not int or value not in frames for value in span) or span[0] > span[1] or
                not isinstance(evidence, list) or len(evidence) > 80 or
                any(type(value) is not int or value < span[0] or value > span[1] for value in evidence)):
            raise HTTPException(422, "Detail frames are outside the confirmed shot")
        for field in ("candidate", "edited_text", "actor_id"):
            if not isinstance(item.get(field), str) or len(item[field]) > 6000:
                raise HTTPException(422, f"Invalid detail {field}")
        if item["decision"] == "edit" and not item["edited_text"].strip():
            raise HTTPException(422, "Edited detail requires human text")
        source = item.get("source")
        if not isinstance(source, dict) or len(json.dumps(source, ensure_ascii=False)) > 12000:
            raise HTTPException(422, "Invalid detail source")
        if item["kind"] == "foot":
            if (source.get("screen_foot") not in SCREEN_FEET or
                    source.get("anatomical_foot") not in ANATOMICAL_FEET or
                    source.get("support_state") not in SUPPORT_STATES or
                    source.get("sole_contact") not in SOLE_CONTACTS or
                    source.get("contact_target") not in {"ground", "object", "none", "unknown"}):
                raise HTTPException(422, "Invalid per-foot detail")
            if source["anatomical_foot"] == "unknown" and not source.get("uncertainty"):
                raise HTTPException(422, "Unknown anatomical side needs a reason")


def validate_coverage(record, items):
    """A completed detail pass must explicitly cover body, camera and two feet per frame."""
    required = {"body", "camera", "foot:screen_left", "foot:screen_right"}
    coverage = {number: set() for number in range(1, len(record["analysis"]["frame_pts"]) + 1)}
    for item in items:
        if item["decision"] == "reject":
            continue
        key = item["kind"]
        if key == "foot":
            key += ":" + item["source"]["screen_foot"]
        for number in range(item["frame_span"][0], item["frame_span"][1] + 1):
            coverage[number].add(key)
    gaps = {number: sorted(required - values) for number, values in coverage.items() if required - values}
    if gaps:
        raise HTTPException(409, f"Detail coverage is incomplete: {len(gaps)} frames")


def import_detail(record, macro, candidate):
    if not valid_macro(record, macro):
        raise HTTPException(409, "Freeze a current macro review first")
    if not isinstance(candidate, dict) or candidate.get("macro_digest") != macro["digest"]:
        raise HTTPException(409, "Detail candidate does not match the frozen macro review")
    if candidate.get("source_fingerprint") != record["source_fingerprint"]:
        raise HTTPException(409, "Detail candidate source changed")
    run_id = candidate.get("run_id")
    if not isinstance(run_id, str) or not run_id or len(run_id) > 100:
        raise HTTPException(422, "Detail run ID is required")
    raw_items = candidate.get("items")
    if not isinstance(raw_items, list):
        raise HTTPException(422, "Detail candidates are required")
    items = [{**item, "decision": "pending", "edited_text": ""} for item in raw_items]
    validate_detail_items(record, items)
    validate_coverage(record, items)
    return {"schema_version": "shot-detail-review.v1", **source_binding(record),
            "macro_digest": macro["digest"], "run_id": run_id, "review_revision": 1,
            "status": "reviewing", "items": items}


def approve_detail(record, detail):
    macro = record.get("macro_review")
    if not valid_macro(record, macro) or detail.get("macro_digest") != macro["digest"]:
        raise HTTPException(409, "Detail review is stale against macro review")
    if any(detail.get(key) != value for key, value in source_binding(record).items()):
        raise HTTPException(409, "Detail review source changed")
    validate_detail_items(record, detail.get("items"))
    if any(item["decision"] == "pending" for item in detail["items"]):
        raise HTTPException(409, "Detail review has pending decisions")
    validate_coverage(record, detail["items"])
