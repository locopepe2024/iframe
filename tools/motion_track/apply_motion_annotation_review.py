"""Apply sparse, human-reviewed keyframe corrections to motion-track.v1.

The source track is never modified. Corrections are explicit per frame and per
joint; all untouched evidence remains unchanged and the output records the
review revision and source fingerprint.
"""
import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path


JOINTS = {
    "nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee",
    "right_knee", "left_ankle", "right_ankle", "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
}
STATUSES = {"tracked", "manual_recovered", "detector_missed", "real_occlusion", "out_of_frame", "pending"}
PHASES = {"unknown", "neutral", "takeoff", "airborne", "landing", "turn", "contact"}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_edit(frame, edit):
    errors = []
    if not isinstance(edit, dict):
        return [f"frame:{frame}:edit_not_object"]
    status = edit.get("status")
    if status is not None and status not in STATUSES:
        errors.append(f"frame:{frame}:invalid_status:{status}")
    body = edit.get("body", {})
    if body is not None and not isinstance(body, dict):
        errors.append(f"frame:{frame}:body_not_object")
    elif isinstance(body, dict):
        phase = body.get("phase")
        if phase is not None and phase not in PHASES:
            errors.append(f"frame:{frame}:invalid_phase:{phase}")
        for key in ("left_foot_contact", "right_foot_contact"):
            if key in body and not isinstance(body[key], bool):
                errors.append(f"frame:{frame}:{key}_not_bool")
        if "root_yaw_degrees" in body and not isinstance(body["root_yaw_degrees"], (int, float)):
            errors.append(f"frame:{frame}:root_yaw_not_number")
    joints = edit.get("joints", {})
    if not isinstance(joints, dict):
        errors.append(f"frame:{frame}:joints_not_object")
    else:
        for name, value in joints.items():
            if name not in JOINTS:
                errors.append(f"frame:{frame}:unknown_joint:{name}")
                continue
            if not isinstance(value, (list, tuple)) or len(value) not in (2, 3):
                errors.append(f"frame:{frame}:invalid_joint:{name}")
                continue
            if any(not isinstance(item, (int, float)) for item in value):
                errors.append(f"frame:{frame}:non_numeric_joint:{name}")
            if not 0 <= float(value[0]) <= 1 or not 0 <= float(value[1]) <= 1:
                errors.append(f"frame:{frame}:joint_out_of_range:{name}")
    return errors


def recompute_centers(joints):
    for name, left, right in (("hip_center", "left_hip", "right_hip"),
                              ("shoulder_center", "left_shoulder", "right_shoulder")):
        if left in joints and right in joints:
            joints[name] = [
                (joints[left][i] + joints[right][i]) / 2 for i in range(3)
            ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--track", required=True)
    parser.add_argument("--annotations", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--reviewer", required=True)
    args = parser.parse_args()
    track_path, annotation_path = Path(args.track), Path(args.annotations)
    track = json.loads(track_path.read_text())
    annotations = json.loads(annotation_path.read_text())
    errors = []
    if track.get("schema") != "motion-track.v1":
        errors.append("source_schema_must_be_motion-track.v1")
    if annotations.get("schema") != "motion-track-annotation-review.v2":
        errors.append("annotation_schema_must_be_motion-track-annotation-review.v2")
    source_revision = annotations.get("source_revision")
    if source_revision and source_revision != track.get("source_revision"):
        errors.append("source_revision_mismatch")
    edits = annotations.get("frames", [])
    by_frame = {int(frame.get("frame")): frame for frame in track.get("frames", [])}
    if len(edits) != len({int(item.get("frame", -1)) for item in edits}):
        errors.append("duplicate_annotation_frame")
    for edit in edits:
        frame = int(edit.get("frame", -1))
        if frame not in by_frame:
            errors.append(f"annotation_frame_not_in_source:{frame}")
        errors.extend(validate_edit(frame, edit))
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 2
    reviewed = copy.deepcopy(track)
    reviewed["schema"] = "motion-track-reviewed.v1"
    reviewed["source_schema"] = "motion-track.v1"
    reviewed["source_track_revision"] = track.get("source_revision")
    reviewed["annotation_schema"] = annotations["schema"]
    reviewed["annotation_digest_sha256"] = digest(annotation_path)
    reviewed["reviewer"] = args.reviewer
    reviewed["review_status"] = annotations.get("review_status", "draft")
    reviewed["reviewed_frames"] = []
    edits_by_frame = {int(item["frame"]): item for item in edits}
    for frame in reviewed.get("frames", []):
        number = int(frame["frame"])
        edit = edits_by_frame.get(number)
        if not edit:
            continue
        joints = frame.get("semantic_joints")
        if not isinstance(joints, dict):
            joints = {}
            frame["semantic_joints"] = joints
        for name, value in edit.get("joints", {}).items():
            value = list(value)
            if len(value) == 2:
                previous = joints.get(name, [0, 0, 0])
                value.append(previous[2] if len(previous) > 2 else 0.0)
            joints[name] = value
        recompute_centers(joints)
        if edit.get("status"):
            frame["selection_status"] = edit["status"]
        frame["review"] = {
            "source": "manual",
            "reviewer": args.reviewer,
            "body": copy.deepcopy(edit.get("body", {})),
            "note": edit.get("reviewer_note"),
            "corrected_joints": sorted(edit.get("joints", {}).keys()),
        }
        reviewed["reviewed_frames"].append(number)
    reviewed["reviewed_frames"].sort()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(reviewed, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"valid": True, "output": str(output), "reviewed_frames": reviewed["reviewed_frames"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
