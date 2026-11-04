"""Validation and import contract for human-reviewed shot analysis."""
import hashlib
import json

from fastapi import HTTPException


KINDS = {"cut_scene", "camera", "optics", "scene", "object", "action", "uncertainty"}
DECISIONS = {"pending", "accept", "edit", "reject", "unknown"}
SUPPORT_SIDES = {"left", "right", "both", "airborne", "unknown"}
CONTACT_TYPES = {"full_sole", "forefoot", "toe", "rolling", "airborne", "unknown"}


def timeline_key(record):
    timeline = record.get("timeline") or {}
    payload = [record.get("source_fingerprint"), record.get("analysis_id"),
               [(shot["id"], shot["start_pts"], shot["end_pts"]) for shot in timeline.get("shots", [])]]
    return hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()


def _frame_span(value, count):
    if (not isinstance(value, list) or len(value) != 2 or
            any(type(frame) is not int or frame < 1 or frame > count for frame in value) or
            value[0] > value[1]):
        raise HTTPException(422, "Review frame span is outside the source")
    return value


def validate_items(items, record):
    if not isinstance(items, list) or len(items) > 300:
        raise HTTPException(422, "Review has too many items")
    frames = record["analysis"]["frame_pts"]
    shots = {shot["id"]: shot for shot in record["timeline"]["shots"]}
    ids = set()
    for item in items:
        if not isinstance(item, dict) or item.get("kind") not in KINDS or item.get("decision") not in DECISIONS:
            raise HTTPException(422, "Invalid review item")
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id or len(item_id) > 100 or item_id in ids:
            raise HTTPException(422, "Review item IDs must be unique")
        ids.add(item_id)
        shot = shots.get(item.get("shot_id"))
        if not shot:
            raise HTTPException(422, "Review item references an unknown shot")
        first, last = _frame_span(item.get("frame_span"), len(frames))
        evidence = item.get("evidence_frames")
        if not isinstance(evidence, list) or len(evidence) > 80 or any(type(n) is not int or n < first or n > last for n in evidence):
            raise HTTPException(422, "Evidence frames must belong to the event")
        if frames[first - 1] < shot["start_pts"] or frames[last - 1] >= shot["end_pts"]:
            raise HTTPException(422, "Review item crosses a confirmed shot boundary")
        if any(frames[n - 1] < shot["start_pts"] or frames[n - 1] >= shot["end_pts"] for n in evidence):
            raise HTTPException(422, "Evidence frame is outside the shot")
        for field in ("candidate", "edited_text", "actor_id"):
            if not isinstance(item.get(field), str) or len(item[field]) > 6000:
                raise HTTPException(422, f"Invalid {field}")
        if item["decision"] == "edit" and not item["edited_text"].strip():
            raise HTTPException(422, "Edited review items require human text")
        if item.get("reviewed_support_side") is not None and (item["kind"] != "action" or item["reviewed_support_side"] not in SUPPORT_SIDES):
            raise HTTPException(422, "Invalid reviewed support side")
        if item.get("reviewed_contact_type") is not None and (item["kind"] != "action" or item["reviewed_contact_type"] not in CONTACT_TYPES):
            raise HTTPException(422, "Invalid reviewed contact type")
        if not isinstance(item.get("source"), dict) or len(json.dumps(item["source"], ensure_ascii=False)) > 12000:
            raise HTTPException(422, "Invalid source candidate")
        if item["source"].get("provenance") == "human" and item["decision"] == "accept" and not item["edited_text"].strip():
            raise HTTPException(422, "Accepted manual annotations require human text")


def import_candidates(raw, record):
    if not isinstance(raw, dict):
        raise HTTPException(422, "Candidate analysis must be a JSON object")
    frames = record["analysis"]["frame_pts"]
    shots = record["timeline"]["shots"]

    def add(kind, ident, span, evidence, candidate, source, actor=""):
        span = _frame_span(span, len(frames))
        match = next((s for s in shots if frames[span[0] - 1] >= s["start_pts"] and frames[span[1] - 1] < s["end_pts"]), None)
        if not match:
            raise HTTPException(422, f"Candidate {ident} crosses a confirmed shot boundary")
        items.append({"id": f"{kind}:{ident}", "kind": kind, "shot_id": match["id"],
                      "frame_span": span, "evidence_frames": evidence,
                      "candidate": candidate, "edited_text": "", "decision": "pending",
                      "actor_id": actor, "source": source})

    def add_uncertainty(ident, span, evidence, value, source):
        if isinstance(value, str) and value.strip() and value.strip().lower() != "none":
            add("uncertainty", ident, span, evidence, value, source)

    items = []
    for index, row in enumerate(raw.get("shot_candidates", []), 1):
        first = row.get("first_frame")
        evidence = row.get("evidence_frames", [])
        if type(first) is not int or not isinstance(evidence, list) or any(type(n) is not int for n in evidence):
            raise HTTPException(422, "Invalid cut candidate frames")
        add("cut_scene", str(index), [min([first, *evidence]), max([first, *evidence])], evidence,
            str(row.get("interpretation", "")), row)
        if row.get("basis") == "unknown":
            add_uncertainty(f"cut-{index}-basis", [min([first, *evidence]), max([first, *evidence])], evidence,
                            "cut basis: unknown", {"parent": row, "field": "basis"})
        add_uncertainty(f"cut-{index}", [min([first, *evidence]), max([first, *evidence])], evidence,
                        row.get("uncertainty"), {"parent": row, "field": "uncertainty"})
    scene = raw.get("scene")
    if isinstance(scene, dict):
        for index, shot in enumerate(shots, 1):
            covered = [number for number, pts in enumerate(frames, 1)
                       if shot["start_pts"] <= pts < shot["end_pts"]]
            if covered:
                add("scene", str(index), [covered[0], covered[-1]], [],
                    ", ".join(scene.get("visible_elements", [])), scene)
                add_uncertainty(f"scene-{index}", [covered[0], covered[-1]], [],
                                scene.get("uncertainty"), {"parent": scene, "field": "uncertainty"})
    for index, row in enumerate(raw.get("object_tracks", []), 1):
        observations = row.get("observations", [])
        observed = [entry.get("frame") for entry in observations if isinstance(entry, dict)]
        if any(type(frame) is not int for frame in observed):
            raise HTTPException(422, "Invalid object observation frame")
        first = row.get("first_visible_frame")
        last = row.get("last_visible_frame")
        if type(first) is not int or type(last) is not int:
            raise HTTPException(422, "Invalid object visible range")
        span = [min(first, last, *observed), max(first, last, *observed)]
        add("object", str(row.get("id") or index), span, sorted(set(observed)),
            str(row.get("description", "")), row)
        add_uncertainty(f"object-{index}", span, sorted(set(observed)),
                        row.get("uncertainty"), {"parent": row, "field": "uncertainty"})
    for index, row in enumerate(raw.get("camera_segments", []), 1):
        span = row.get("frame_span")
        evidence = row.get("evidence_frames", [])
        add("camera", str(row.get("id") or index), span, evidence,
            str(row.get("interpretation", "")), row)
        add("optics", str(row.get("id") or index), span, evidence,
            f"{row.get('optical_change', 'unknown')}: {row.get('view_scale_start', '')} -> {row.get('view_scale_end', '')}", row)
        for field in ("position_motion", "orientation_motion", "optical_change"):
            if row.get(field) == "unknown":
                add_uncertainty(f"camera-{index}-{field}", span, evidence, f"{field}: unknown", {"parent": row, "field": field})
        add_uncertainty(f"camera-{index}", span, evidence, row.get("uncertainty"), {"parent": row, "field": "uncertainty"})
    for index, row in enumerate(raw.get("events", []), 1):
        span = row.get("frame_span")
        evidence = row.get("evidence_frames", [])
        if isinstance(span, list) and len(span) == 2 and all(type(n) is int for n in span) and isinstance(evidence, list):
            evidence = [frame for frame in evidence if type(frame) is int and span[0] <= frame <= span[1]]
        add("action", str(row.get("id") or index), span, evidence,
            str(row.get("action", "")), row, str(row.get("actor_id", "")))
        add_uncertainty(f"action-{index}-uncertainty", span, evidence,
                        row.get("uncertainty"), {"parent": row, "field": "uncertainty"})
        left_right = row.get("left_right_basis")
        if isinstance(left_right, str) and any(marker in left_right.lower() for marker in ("unknown", "uncertain", "无法", "不确定", "不可")):
            add_uncertainty(f"action-{index}-left_right_basis", span, evidence, left_right,
                            {"parent": row, "field": "left_right_basis"})
        if row.get("contact") == "unknown":
            add_uncertainty(f"action-{index}-contact", span, evidence, "contact: unknown", {"parent": row, "field": "contact"})
    for index, row in enumerate(raw.get("transitions", []), 1):
        evidence = row.get("evidence_frames", [])
        if evidence:
            add_uncertainty(f"transition-{index}", [min(evidence), max(evidence)], evidence,
                            row.get("unknown"), {"parent": row, "field": "unknown"})
    for index, value in enumerate(raw.get("unresolved", []), 1):
        for shot in shots:
            covered = [number for number, pts in enumerate(frames, 1) if shot["start_pts"] <= pts < shot["end_pts"]]
            if covered:
                add_uncertainty(f"unresolved-{index}-{shot['id']}", [covered[0], covered[-1]], [], value,
                                {"provenance": "model_candidate", "field": "unresolved", "index": index})
    validate_items(items, record)
    return items
