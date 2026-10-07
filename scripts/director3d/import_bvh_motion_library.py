"""Probe-import a BVH into Blender and emit an auditable ingest manifest.

This deliberately stops before retargeting. The imported source armature is
inspected and then discarded; the source .blend file is never saved.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy


def args():
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--bvh", required=True)
    parser.add_argument("--source-blend", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--motion-id", required=True)
    parser.add_argument("--retarget-plugin", default="none", choices=("none", "expy_kit", "rokoko_studio_live", "native_blender"))
    parser.add_argument("--retarget-plugin-version", default=None)
    return parser.parse_args(raw)


def main():
    parsed = args()
    bvh = Path(parsed.bvh).resolve()
    source_blend = Path(parsed.source_blend).resolve()
    output = Path(parsed.output).resolve()
    if not bvh.is_file() or bvh.suffix.lower() != ".bvh":
        raise SystemExit("--bvh must point to a local .bvh file")
    if not source_blend.is_file():
        raise SystemExit("--source-blend must point to a .blend file")
    bpy.ops.wm.open_mainfile(filepath=str(source_blend))
    before = {obj.name for obj in bpy.data.objects}
    result = bpy.ops.import_anim.bvh(filepath=str(bvh), target="ARMATURE", use_fps_scale=True)
    if "FINISHED" not in result:
        raise SystemExit("Blender did not finish importing BVH")
    imported = [obj for obj in bpy.data.objects if obj.name not in before and obj.type == "ARMATURE"]
    actions = []
    bones = []
    frame_range = None
    fps = float(bpy.context.scene.render.fps)
    for armature in imported:
        bones.extend(sorted(bone.name for bone in armature.data.bones))
        action = armature.animation_data.action if armature.animation_data else None
        if action is not None:
            actions.append(action.name)
            start, end = action.frame_range
            frame_range = [int(start), int(end)]
    manifest = {
        "schema": "director3d-motion-library.ingest.v1",
        "status": "imported" if imported and actions else "warning",
        "motionId": parsed.motion_id,
        "source": {"format": "bvh", "fileName": bvh.name, "sha256": hashlib.sha256(bvh.read_bytes()).hexdigest()},
        "blenderVersion": bpy.app.version_string,
        "importedArmatures": sorted(obj.name for obj in imported),
        "actions": sorted(set(actions)),
        "boneNames": sorted(set(bones)),
        "frameRange": frame_range,
        "fps": fps,
        "retargetPlugin": {"id": parsed.retarget_plugin, "version": parsed.retarget_plugin_version, "status": "not_run"},
        "retargetStatus": "unmapped",
        "warnings": [] if imported and actions else ["BVH imported without a usable armature action; retargeting is not admitted."],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
