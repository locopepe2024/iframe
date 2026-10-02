"""Build a read-only rest-basis calibration report for a Blender rig."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SEGMENTS = {
    "clavicle_l": ("shoulder_center", "left_shoulder"),
    "upper_arm_l": ("left_shoulder", "left_elbow"),
    "lower_arm_l": ("left_elbow", "left_wrist"),
    "clavicle_r": ("shoulder_center", "right_shoulder"),
    "upper_arm_r": ("right_shoulder", "right_elbow"),
    "lower_arm_r": ("right_elbow", "right_wrist"),
    "upper_leg_l": ("left_hip", "left_knee"),
    "lower_leg_l": ("left_knee", "left_ankle"),
    "upper_leg_r": ("right_hip", "right_knee"),
    "lower_leg_r": ("right_knee", "right_ankle"),
}


def args():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", required=True)
    p.add_argument("--source-blend", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--frames", default="1,60,120,150,180,240,360,480,556")
    return p.parse_args(raw)


def unit(v):
    return v.normalized() if v.length > 1e-8 else None


def angle(a, b):
    a, b = unit(a), unit(b)
    return math.degrees(a.angle(b)) if a and b else None


def main():
    a = args()
    manifest = json.loads(Path(a.manifest).read_text())
    cases = {int(c["frame"]): c for c in manifest.get("cases", [])}
    bpy.ops.wm.open_mainfile(filepath=str(Path(a.source_blend).resolve()))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    bones = {}
    for name in set(SEGMENTS) | {"pelvis", "spine_lower", "spine_mid", "spine_chest"}:
        b = arm.data.bones.get(name)
        if not b:
            continue
        rest = Vector(b.tail_local) - Vector(b.head_local)
        bones[name] = {
            "parent": b.parent.name if b.parent else None,
            "rest_head": list(b.head_local),
            "rest_tail": list(b.tail_local),
            "rest_direction_armature": list(unit(rest)),
            "rest_length": b.length,
            "rest_local_y_in_armature": list(unit(b.matrix_local.to_3x3() @ Vector((0, 1, 0)))),
        }
    frame_reports = []
    for frame in [int(x) for x in a.frames.split(",") if x.strip()]:
        case = cases.get(frame)
        if not case:
            continue
        j = case.get("semantic_joints", {})
        points = {k: Vector((p[0], p[2], -p[1])) for k, p in j.items()}
        if "left_hip" in points and "right_hip" in points:
            points["hip_center"] = (points["left_hip"] + points["right_hip"]) * 0.5
        if "left_shoulder" in points and "right_shoulder" in points:
            points["shoulder_center"] = (points["left_shoulder"] + points["right_shoulder"]) * 0.5
        segments = {}
        for name, (src_a, src_b) in SEGMENTS.items():
            if name not in bones or src_a not in points or src_b not in points:
                continue
            source = points[src_b] - points[src_a]
            segments[name] = {
                "source_direction_armature": list(unit(source)),
                "source_length": source.length,
                "rest_to_source_angle_degrees": angle(Vector(bones[name]["rest_direction_armature"]), source),
                "parent": bones[name]["parent"],
            }
        frame_reports.append({"source_frame": frame, "segments": segments})
    result = {
        "schema": "blender-rig-calibration-report.v1",
        "rig_asset": Path(a.source_blend).name,
        "source_manifest": Path(a.manifest).name,
        "coordinate_mapping": "source(x,y,z) -> armature(x,z,-y)",
        "bones": bones,
        "frames": frame_reports,
        "evidence_boundary": {
            "observed": ["rest bone axes and source segment directions"],
            "not_proven": ["camera calibration", "true depth", "twist", "IK", "temporal continuity"],
        },
    }
    Path(a.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": a.output, "bones": len(bones), "frames": len(frame_reports)}))


if __name__ == "__main__":
    main()
