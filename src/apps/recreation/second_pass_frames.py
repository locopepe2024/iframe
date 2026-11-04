"""Build source-bound, adjacent-frame evidence for the second model pass."""

from fractions import Fraction
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import HTTPException

from .analysis import INPUT_OPTIONS, fingerprint, run
from .candidate_completion import candidate_digest
from .shot_review import timeline_key


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
        shot_frames = shots[item["shot_id"]]
        first, last = item["frame_span"]
        evidence = item["evidence_frames"]
        anchors = {first, last, (first + last) // 2}
        if evidence:
            anchors.update((evidence[0], evidence[len(evidence) // 2], evidence[-1]))
        selected = {n for anchor in anchors for n in (anchor - 1, anchor, anchor + 1)
                    if n in shot_frames}
        windows.append({"item_id": item["id"], "shot_id": item["shot_id"],
                        "kind": item["kind"], "frame_span": item["frame_span"],
                        "first_analysis": item["candidate"], "first_analysis_source": item["source"],
                        "context": [{"item_id": row["id"], "kind": row["kind"],
                                     "frame_span": row["frame_span"], "first_analysis": row["candidate"]}
                                    for row in items if row["id"] != item["id"]
                                    and row["shot_id"] == item["shot_id"]
                                    and row["source"].get("provenance") != "human"
                                    and row["frame_span"][0] <= last + 1
                                    and row["frame_span"][1] >= first - 1],
                        "review_priority": item["decision"] == "pending",
                        "reference_frames": sorted(selected)})
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
