"""Export read-only rest-pose evidence from a Blender armature.

Usage:
  blender -b character.blend --python export_blender_rig_rest.py -- --output rig-rest.json
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--armature")
    return parser.parse_args(raw)


def vector(value):
    return [round(float(axis), 8) for axis in value]


def main():
    args = parse_args()
    armatures = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    if args.armature:
        armatures = [obj for obj in armatures if obj.name == args.armature]
    if len(armatures) != 1:
        raise SystemExit(f"expected one armature, found {len(armatures)}")

    armature = armatures[0]
    blend_path = Path(bpy.data.filepath)
    if not blend_path.is_file():
        raise SystemExit("source .blend file is required")
    digest = hashlib.sha256(blend_path.read_bytes()).hexdigest()
    bones = []
    for bone in armature.data.bones:
        rest = bone.matrix_local.to_quaternion()
        direction = bone.tail_local - bone.head_local
        direction.normalize()
        bones.append(
            {
                "name": bone.name,
                "parent": bone.parent.name if bone.parent else None,
                "deform": bool(bone.use_deform),
                "head_armature": vector(bone.head_local),
                "tail_armature": vector(bone.tail_local),
                "direction_armature": vector(direction),
                "rest_quaternion_armature_xyzw": vector((rest.x, rest.y, rest.z, rest.w)),
                "length_m": round(float(bone.length), 8),
            }
        )

    result = {
        "schema": "director-rig-rest-evidence.v1",
        "rig_asset": blend_path.name,
        "rig_sha256": digest,
        "blender_version": bpy.app.version_string,
        "armature": armature.name,
        "coordinate_space": "armature_local_rest",
        "quaternion_order": "xyzw",
        "bone_count": len(bones),
        "bones": bones,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(output), "bone_count": len(bones), "rig_sha256": digest}))


if __name__ == "__main__":
    main()
