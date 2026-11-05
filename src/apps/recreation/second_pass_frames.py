"""Build source-bound, adjacent-frame evidence for the second model pass."""

from fractions import Fraction
from io import BytesIO
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import HTTPException

from .analysis import INPUT_OPTIONS, fingerprint, run
from .candidate_completion import candidate_digest
from .shot_review import timeline_key


FRAME_RANGE = re.compile(r"(?<!\d)(\d{1,4})\s*(?:[-–—~～]|至|到)\s*(\d{1,4})\s*帧?")
SINGLE_FRAME = re.compile(r"第\s*(\d{1,4})\s*帧")


def mentioned_frames(text, available):
    selected = set()
    for match in FRAME_RANGE.finditer(text):
        first, last = map(int, match.groups())
        if first <= last and last - first <= 12:
            selected.update(range(first, last + 1))
    selected.update(int(match.group(1)) for match in SINGLE_FRAME.finditer(text))
    return selected & available


def review_text(item):
    if item["decision"] in {"edit", "unknown"} and (item.get("edited_text") or "").strip():
        return item["edited_text"].strip()
    if item["source"].get("provenance") == "human":
        return (item.get("edited_text") or "").strip()
    return item["candidate"].strip()


def semantic_pool(items, shot_id):
    pool = []
    for item in items:
        if item["shot_id"] != shot_id:
            continue
        decision = item["decision"]
        if decision == "reject":
            continue
        pool.append({"item_id": item["id"], "kind": item["kind"],
                     "frame_span": item["frame_span"], "decision": decision,
                     "text": review_text(item),
                     "provenance": item["source"].get("provenance", "model_candidate")})
    return pool


def contiguous_clips(selected):
    clips = []
    for frame in sorted(selected):
        if clips and frame == clips[-1][-1] + 1:
            clips[-1].append(frame)
        else:
            clips.append([frame])
    return clips


def frame_windows(record):
    frames = record["analysis"]["frame_pts"]
    items = (record.get("shot_review") or {}).get("items", [])
    shots = {shot["id"]: [n for n, pts in enumerate(frames, 1)
                           if shot["start_pts"] <= pts < shot["end_pts"]]
             for shot in record["timeline"]["shots"]}
    windows = []
    for item in items:
        if item["source"].get("provenance") == "human":
            continue
        shot_frames = set(shots[item["shot_id"]])
        first, last = item["frame_span"]
        evidence = item["evidence_frames"]
        anchors = {first, last, (first + last) // 2}
        if evidence:
            anchors.update((evidence[0], evidence[len(evidence) // 2], evidence[-1]))
        explicit = mentioned_frames(review_text(item), shot_frames)
        anchors.update(explicit)
        if item["kind"] == "uncertainty" and last - first >= 20 and not explicit:
            anchors.update(row["frame_span"][0] for row in items
                           if row["kind"] == "action" and row["shot_id"] == item["shot_id"]
                           and first <= row["frame_span"][0] <= last)
        selected = {n for anchor in anchors for n in (anchor - 1, anchor, anchor + 1)
                    if n in shot_frames}
        if item["kind"] == "action" and last - first <= 12:
            selected.update(n for n in range(first, last + 1) if n in shot_frames)
        # Keep neighboring action phases together at their shared boundary.
        if item["kind"] in {"action", "uncertainty"}:
            for row in items:
                if row["shot_id"] != item["shot_id"] or row["kind"] != "action":
                    continue
                boundary = row["frame_span"][0]
                if first - 2 <= boundary <= last + 2:
                    selected.update(n for n in range(boundary - 2, boundary + 2)
                                    if n in shot_frames)
        windows.append({"item_id": item["id"], "shot_id": item["shot_id"],
                        "kind": item["kind"], "frame_span": item["frame_span"],
                        "first_analysis": review_text(item),
                        "first_analysis_source": (item["source"] if not (
                            item["decision"] in {"edit", "unknown"} and
                            (item.get("edited_text") or "").strip()) else
                                                  {"provenance": item["source"].get("provenance"),
                                                   "field": item["source"].get("field")}),
                        "context": [{"item_id": row["id"], "kind": row["kind"],
                                     "frame_span": row["frame_span"], "first_analysis": review_text(row),
                                     "decision": row["decision"]}
                                    for row in items if row["id"] != item["id"]
                                    and row["shot_id"] == item["shot_id"]
                                    and row["decision"] != "reject"
                                    and row["source"].get("provenance") != "human"
                                    and row["frame_span"][0] <= last + 1
                                    and row["frame_span"][1] >= first - 1],
                        "review_priority": item["decision"] == "pending",
                        "reference_frames": sorted(selected),
                        "reference_clips": contiguous_clips(selected),
                        "shot_semantics": semantic_pool(items, item["shot_id"])})
    return sorted(windows, key=lambda row: not row["review_priority"])


def build_frame_pack(record, source: Path):
    if not record.get("analysis") or not record.get("timeline") or not record.get("shot_review"):
        raise HTTPException(409, "Confirmed timeline and first analysis are required")
    windows = frame_windows(record)
    if not windows:
        raise HTTPException(409, "No model candidates are available")
    selected = sorted({n for window in windows for n in window["reference_frames"]})
    if len(selected) > 240:
        raise HTTPException(422, "Second-pass frame pack exceeds 240 frames; narrow the review")
    if fingerprint(source) != record["source_fingerprint"]:
        raise HTTPException(409, "Source fingerprint changed")
    with TemporaryDirectory() as directory:
        folder = Path(directory)
        expression = "+".join(f"eq(n\\,{n - 1})" for n in selected)
        run(["ffmpeg", "-nostdin", "-v", "error", *INPUT_OPTIONS, "-threads", "1",
             "-i", str(source), "-map", "0:v:0", "-an", "-vf",
             f"select={expression},scale=960:960:force_original_aspect_ratio=decrease",
             "-fps_mode", "vfr", "-threads", "1", str(folder / "frame-%04d.jpg")], timeout=90)
        images = sorted(folder.glob("frame-*.jpg"))
        if len(images) != len(selected) or fingerprint(source) != record["source_fingerprint"]:
            raise HTTPException(409, "Source frame extraction changed or is incomplete")
        pts = record["analysis"]["frame_pts"]
        time_base = Fraction(record["analysis"]["time_base"])
        manifest = {"schema_version": "shot-second-pass-frames.v1",
                    "source_fingerprint": record["source_fingerprint"],
                    "analysis_id": record["analysis_id"],
                    "timeline_key": timeline_key(record),
                    "candidate_digest": candidate_digest(record),
                    "frames": [{"frame": n, "pts": pts[n - 1],
                                "seconds": float((pts[n - 1] - pts[0]) * time_base),
                                "file": f"frames/{n:04d}.jpg"} for n in selected],
                    "candidates": windows}
        output = BytesIO()
        with ZipFile(output, "w", ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            for n, image in zip(selected, images):
                archive.write(image, f"frames/{n:04d}.jpg")
    return output.getvalue()
