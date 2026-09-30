"""Convert the legacy media pose track into canonical motion-track.v1.

The converter is explicit and loss-aware: it maps MediaPipe landmark indices
to semantic joints and leaves occluded frames without fabricated joints.
"""

import argparse
import hashlib
import json
from pathlib import Path


JOINTS = {
    "left_shoulder": 11, "right_shoulder": 12, "left_elbow": 13, "right_elbow": 14,
    "left_wrist": 15, "right_wrist": 16, "left_hip": 23, "right_hip": 24,
    "left_knee": 25, "right_knee": 26, "left_ankle": 27, "right_ankle": 28,
    "left_heel": 29, "right_heel": 30, "left_foot_index": 31, "right_foot_index": 32,
}


def point(landmarks, index):
    if not isinstance(landmarks, list) or index >= len(landmarks):
        return None
    value = landmarks[index]
    if not isinstance(value, list) or len(value) < 4 or float(value[3]) < 0.2:
        return None
    return [float(value[0]), float(value[1]), float(value[2])]


def convert(source, source_bytes):
    source_fps = float(source.get("source", {}).get("fps", 24.0))
    frames = []
    for item in source.get("frames", []):
        landmarks = item.get("target_landmarks")
        joints = {name: value for name, index in JOINTS.items() if (value := point(landmarks, index)) is not None}
        confidence = {
            name: float(landmarks[index][3])
            for name, index in JOINTS.items()
            if isinstance(landmarks, list) and index < len(landmarks) and isinstance(landmarks[index], list) and len(landmarks[index]) >= 4
        }
        feet = {
            side: {
                "ankle": joints.get(f"{side}_ankle"),
                "heel": joints.get(f"{side}_heel"),
                "toe": joints.get(f"{side}_foot_index"),
            }
            for side in ("left", "right")
        }
        frames.append({
            "frame": int(item["frame"]),
            "source_frame": int(item["frame"]),
            "source_timestamp_seconds": float(item.get("timestamp_seconds", 0.0)),
            "selection_status": item.get("selection_status", "unknown"),
            "root_position": None,
            "semantic_joints": joints,
            "joint_confidence": confidence,
            "foot_targets": feet,
            "foot_contact_candidates": {
                "left": {"candidate": False, "confidence": 0.0},
                "right": {"candidate": False, "confidence": 0.0},
            },
        })
    return {
        "schema": "motion-track.v1",
        "track_id": source.get("target_selection", {}).get("target_subject_id", "person-center"),
        "source_revision": hashlib.sha256(source_bytes).hexdigest(),
        "coordinate_system": {"image_x": "blender_x", "image_y": "blender_z", "depth_z": "blender_y"},
        "source": {"fps": source_fps, "source_schema": source.get("schema")},
        "frames": frames,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    raw = Path(args.input).read_bytes()
    result = convert(json.loads(raw), raw)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": args.output, "frames": len(result["frames"]), "revision": result["source_revision"]}))


if __name__ == "__main__":
    main()
