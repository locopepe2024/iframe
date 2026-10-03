"""Build deterministic synthetic pose cases for coordinate calibration.

The fixture is intentionally independent of a detector and a source video. It
uses image-space x/y plus a nominal z value, so failures identify mapping or
rig-calibration problems rather than detector noise.
"""
import argparse
import json
from pathlib import Path


BASE = {
    "nose": (0.50, 0.16, 0.00),
    "left_shoulder": (0.42, 0.30, 0.00),
    "right_shoulder": (0.58, 0.30, 0.00),
    "left_elbow": (0.34, 0.43, 0.00),
    "right_elbow": (0.66, 0.43, 0.00),
    "left_wrist": (0.28, 0.56, 0.00),
    "right_wrist": (0.72, 0.56, 0.00),
    "left_hip": (0.45, 0.58, 0.00),
    "right_hip": (0.55, 0.58, 0.00),
    "left_knee": (0.44, 0.78, 0.00),
    "right_knee": (0.56, 0.78, 0.00),
    "left_ankle": (0.43, 0.96, 0.00),
    "right_ankle": (0.57, 0.96, 0.00),
    "left_heel": (0.41, 0.99, 0.00),
    "right_heel": (0.59, 0.99, 0.00),
    "left_foot_index": (0.37, 0.99, 0.00),
    "right_foot_index": (0.63, 0.99, 0.00),
}


def case(frame, name, updates):
    joints = {key: list(value) for key, value in BASE.items()}
    for key, value in updates.items():
        joints[key] = list(value)
    return {
        "frame": frame,
        "timestamp_seconds": (frame - 1) / 30.0,
        "semantic_joints": joints,
        "selection_status": "fixture",
        "fixture_case": name,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    cases = [
        case(1, "neutral", {}),
        case(2, "left_arm_up", {
            "left_elbow": (0.34, 0.20, 0.00),
            "left_wrist": (0.27, 0.08, 0.00),
        }),
        case(3, "right_arm_up", {
            "right_elbow": (0.66, 0.20, 0.00),
            "right_wrist": (0.73, 0.08, 0.00),
        }),
        case(4, "left_leg_out", {
            "left_knee": (0.32, 0.76, 0.00),
            "left_ankle": (0.22, 0.93, 0.00),
            "left_heel": (0.20, 0.96, 0.00),
            "left_foot_index": (0.13, 0.95, 0.00),
        }),
        case(5, "right_leg_out", {
            "right_knee": (0.68, 0.76, 0.00),
            "right_ankle": (0.78, 0.93, 0.00),
            "right_heel": (0.80, 0.96, 0.00),
            "right_foot_index": (0.87, 0.95, 0.00),
        }),
        case(6, "torso_lean_left", {
            "left_shoulder": (0.37, 0.31, 0.00),
            "right_shoulder": (0.53, 0.31, 0.00),
            "left_elbow": (0.29, 0.44, 0.00),
            "right_elbow": (0.61, 0.44, 0.00),
            "left_wrist": (0.23, 0.57, 0.00),
            "right_wrist": (0.67, 0.57, 0.00),
        }),
    ]
    output = {
        "schema": "single-frame-motion-validation.v1",
        "fixture_schema": "pose-calibration-fixture.v1",
        "source_track_revision": "fixture",
        "source_video": None,
        "cases": cases,
        "validation_axes": ["neutral", "left_arm", "right_arm", "left_leg", "right_leg", "torso"],
        "evidence_boundary": {
            "observed": ["synthetic coordinate and side mapping only"],
            "not_proven": ["detector accuracy", "true depth", "temporal continuity", "camera calibration", "visual match to a source video"],
        },
    }
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(path), "cases": len(cases)}))


if __name__ == "__main__":
    main()
