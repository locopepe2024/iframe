"""Freeze a confirmed shot review for an offline motion pass."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

from src.apps.recreation.shot_review import timeline_key, validate_items


def build_handoff(record: dict, shot_index: int, expected_revision: int) -> dict:
    analysis = record.get("analysis") or {}
    timeline = record.get("timeline") or {}
    review = record.get("shot_review") or {}
    shots = timeline.get("shots") or []
    if not 0 <= shot_index < len(shots):
        raise ValueError("shot index is outside the confirmed timeline")
    if review.get("review_revision") != expected_revision or expected_revision < 1:
        raise ValueError("review revision changed")
    if review.get("analysis_id") != record.get("analysis_id") or review.get("timeline_key") != timeline_key(record):
        raise ValueError("review is stale against the confirmed timeline")
    if review.get("source_fingerprint") != record.get("source_fingerprint"):
        raise ValueError("review source fingerprint changed")
    validate_items(review.get("items"), record)

    shot = shots[shot_index]
    frame_pts = analysis["frame_pts"]
    frames = [i for i, pts in enumerate(frame_pts, 1) if shot["start_pts"] <= pts < shot["end_pts"]]
    if not frames:
        raise ValueError("shot contains no indexed source frames")
    items = [item for item in review["items"] if item["shot_id"] == shot["id"]]
    if not items or any(item["decision"] == "pending" for item in items):
        raise ValueError("shot has no reviewed items or still has pending items")
    missing = [item["id"] for item in items if item["kind"] == "action"
               and item["decision"] in {"accept", "edit"}
               and (not item.get("reviewed_support_side") or not item.get("reviewed_contact_type"))]
    if missing:
        raise ValueError(f"action support/contact review is missing: {', '.join(missing)}")

    events = []
    for item in items:
        decision = item["decision"]
        reviewed_text = item["edited_text"].strip() if decision == "edit" else item["candidate"].strip() if decision == "accept" else ""
        events.append({
            "id": item["id"], "kind": item["kind"], "decision": decision,
            "frame_span": item["frame_span"], "evidence_frames": item["evidence_frames"],
            "actor_id": item["actor_id"], "reviewed_text": reviewed_text,
            "source_provenance": item["source"].get("provenance", "model_candidate"),
            "support_side": item.get("reviewed_support_side") if item["kind"] == "action" else None,
            "contact_type": item.get("reviewed_contact_type") if item["kind"] == "action" else None,
        })
    return {
        "schema": "iframe.reviewed-shot-motion-handoff.v2",
        "project_id": record["id"], "analysis_id": record["analysis_id"],
        "source_fingerprint": record["source_fingerprint"],
        "review_revision": expected_revision, "timeline_key": review["timeline_key"],
        "shot_id": shot["id"], "shot_index": shot_index,
        "start_pts": shot["start_pts"], "end_pts": shot["end_pts"],
        "time_base": analysis["time_base"], "frame_range": [frames[0], frames[-1]],
        "frame_pts": [frame_pts[i - 1] for i in frames],
        "events": events,
        "constraints": {"hard_ik_intervals": [], "contact_policy": "no_hard_ik_without_sole_geometry"},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=Path("output/recreation.sqlite3"))
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--shot-index", type=int, default=0)
    parser.add_argument("--review-revision", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    connection = sqlite3.connect(f"file:{args.database.resolve()}?mode=ro", uri=True)
    try:
        row = connection.execute("SELECT data FROM projects WHERE id=?", (args.project_id,)).fetchone()
    finally:
        connection.close()
    if row is None:
        raise ValueError("project not found")
    record = json.loads(row[0])
    source = (args.database.parent / record["source_url"]).resolve(strict=True)
    if hashlib.sha256(source.read_bytes()).hexdigest() != record["source_fingerprint"]:
        raise ValueError("source file no longer matches the reviewed fingerprint")
    handoff = build_handoff(record, args.shot_index, args.review_revision)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(handoff, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"exported {handoff['shot_id']} frames {handoff['frame_range']} review v{handoff['review_revision']}")


if __name__ == "__main__":
    main()
