"""Inspect a candidate Quaternius-to-white-model pose transfer in Blender."""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_hash(path, expected):
    actual = sha256(path)
    if actual != expected:
        raise ValueError(f"SHA-256 mismatch for {path.name}: {actual}")
    return actual


def import_armature(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    armatures = [obj for obj in bpy.data.objects if obj not in before and obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise ValueError(f"expected one armature in {path.name}, found {len(armatures)}")
    return armatures[0]


def quaternion_angle(left, right):
    dot = abs(left.normalized().dot(right.normalized()))
    return math.degrees(2 * math.acos(min(1.0, max(0.0, dot))))


def finite_quaternion(value):
    return all(math.isfinite(component) for component in value)


def direction_angle(source, source_bone, target, target_bone):
    source_direction = source.matrix_world.to_3x3() @ (source_bone.tail - source_bone.head)
    target_direction = target.matrix_world.to_3x3() @ (target_bone.tail - target_bone.head)
    if source_direction.length < 1e-8 or target_direction.length < 1e-8:
        raise ValueError("zero-length evaluated bone direction")
    return math.degrees(source_direction.angle(target_direction))


def world_position(armature, bone, endpoint="head"):
    position = getattr(bone, endpoint)
    return [round(value, 5) for value in armature.matrix_world @ position]


def distance(left, right):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right)))


def render_preview(source, output):
    for obj in source.children_recursive:
        if obj.type == "MESH":
            obj.hide_render = True
    camera_data = bpy.data.cameras.new("diagnostic-camera")
    camera = bpy.data.objects.new("diagnostic-camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (3.4, -5.5, 2.3)
    focus = Vector((0, 0, 0.95))
    camera.rotation_euler = (focus - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.8
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)


def main():
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview-dir", type=Path)
    args = parser.parse_args(raw)

    mapping = json.loads(args.mapping.read_text())
    if mapping.get("schema") != "director3d-bone-map.v1" or mapping.get("retargetStatus") != "unmapped":
        raise ValueError("candidate mapping schema or status is invalid")
    source_hash = require_hash(args.source, mapping["sourceSha256"])
    source_buffer = args.source.with_name("AnimationLibrary_Godot_Standard.bin")
    buffer_hash = require_hash(source_buffer, mapping["sourceBufferSha256"])
    target_hash = require_hash(args.target, mapping["targetSha256"])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    source = import_armature(args.source)
    target = import_armature(args.target)
    pairs = mapping["pairs"]
    if len({item["target"] for item in pairs}) != len(pairs):
        raise ValueError("duplicate target bone in mapping")
    for item in pairs:
        if item["source"] not in source.pose.bones or item["target"] not in target.pose.bones:
            raise ValueError(f"missing mapped bone: {item}")

    source_rest = {item["source"]: source.data.bones[item["source"]].matrix_local.to_quaternion() for item in pairs}
    target_rest = {item["target"]: target.data.bones[item["target"]].matrix_local.to_quaternion() for item in pairs}
    actions = ("Punch_Jab", "Punch_Cross", "Sword_Attack")
    reports = []
    if args.preview_dir:
        args.preview_dir.mkdir(parents=True, exist_ok=True)
    for name in actions:
        action = bpy.data.actions.get(name)
        if not action or not action.slots:
            raise ValueError(f"missing usable action: {name}")
        source.animation_data_create()
        source.animation_data.action = action
        source.animation_data.action_slot = action.slots[0]
        start, end = (round(value) for value in action.frame_range)
        sample_frames = range(start, end + 1)
        samples = []
        previous = {}
        previous_source = {}
        for frame in sample_frames:
            bpy.context.scene.frame_set(frame)
            for bone in target.pose.bones:
                bone.rotation_mode = "QUATERNION"
                bone.rotation_quaternion = Quaternion((1, 0, 0, 0))
                bone.location = (0, 0, 0)
                bone.scale = (1, 1, 1)
            bpy.context.view_layer.update()
            residuals = {}
            direction_errors = {}
            continuity = {}
            source_continuity = {}
            source_motion = {}
            for item in pairs:
                source_bone = source.pose.bones[item["source"]]
                target_bone = target.pose.bones[item["target"]]
                source_rotation = source_bone.matrix.to_quaternion()
                if item["target"] in previous_source:
                    source_continuity[item["target"]] = round(quaternion_angle(previous_source[item["target"]], source_rotation), 4)
                previous_source[item["target"]] = source_rotation.copy()
                source_delta = source_bone.matrix.to_quaternion() @ source_rest[item["source"]].inverted()
                source_motion[item["target"]] = round(quaternion_angle(source_delta, Quaternion((1, 0, 0, 0))), 4)
                desired_rotation = source_delta @ target_rest[item["target"]]
                desired_pose = target_bone.matrix.copy()
                desired_pose = Matrix.Translation(desired_pose.translation) @ desired_rotation.to_matrix().to_4x4()
                target_bone.rotation_quaternion = target.convert_space(
                    pose_bone=target_bone, matrix=desired_pose, from_space="POSE", to_space="LOCAL"
                ).to_quaternion()
                bpy.context.view_layer.update()
                evaluated = target_bone.matrix.to_quaternion()
                if not finite_quaternion(target_bone.rotation_quaternion) or not finite_quaternion(evaluated):
                    raise ValueError(f"non-finite quaternion: {name} frame {frame} {item['target']}")
                residuals[item["target"]] = round(quaternion_angle(evaluated, desired_rotation), 4)
                direction_errors[item["target"]] = round(direction_angle(source, source_bone, target, target_bone), 4)
                if item["target"] in previous:
                    continuity[item["target"]] = round(quaternion_angle(previous[item["target"]], evaluated), 4)
                previous[item["target"]] = evaluated.copy()
            source_points = {
                "pelvis": world_position(source, source.pose.bones["DEF-hips"]),
                "foot_l": world_position(source, source.pose.bones["DEF-foot.L"], "tail"),
                "foot_r": world_position(source, source.pose.bones["DEF-foot.R"], "tail"),
            }
            target_points = {
                "pelvis": world_position(target, target.pose.bones["pelvis"]),
                "foot_l": world_position(target, target.pose.bones["foot_l"], "tail"),
                "foot_r": world_position(target, target.pose.bones["foot_r"], "tail"),
            }
            samples.append({"frame": frame, "sourceMotionDeg": source_motion, "sourceFrameStepDeg": source_continuity, "rotationResidualDeg": residuals, "directionErrorDeg": direction_errors, "frameStepDeg": continuity, "sourcePointsM": source_points, "targetPointsM": target_points})
            if args.preview_dir and frame == (start + end) // 2:
                render_preview(source, args.preview_dir / f"{name}-frame-{frame}.png")
        first, last = samples[0], samples[-1]
        travel = {
            "sourcePelvisM": round(distance(first["sourcePointsM"]["pelvis"], last["sourcePointsM"]["pelvis"]), 5),
            "targetPelvisM": round(distance(first["targetPointsM"]["pelvis"], last["targetPointsM"]["pelvis"]), 5),
        }
        foot_heights = {
            side: {
                scope: [min(sample[f"{scope}PointsM"][side][2] for sample in samples), max(sample[f"{scope}PointsM"][side][2] for sample in samples)]
                for scope in ("source", "target")
            }
            for side in ("foot_l", "foot_r")
        }
        reports.append({"action": name, "frameRange": [start, end], "pelvisTravelM": travel, "footHeightRangeM": foot_heights, "previewFrame": (start + end) // 2 if args.preview_dir else None, "samples": samples})

    report = {
        "schema": "director3d-retarget-diagnostic.v1",
        "status": "candidate_only",
        "mappingRevision": mapping["revision"],
        "mappingSha256": sha256(args.mapping),
        "sourceSha256": source_hash,
        "sourceBufferSha256": buffer_hash,
        "targetGlbSha256": target_hash,
        "blenderVersion": bpy.app.version_string,
        "mappedBones": len(pairs),
        "sourceBones": len(source.data.bones),
        "targetBones": len(target.data.bones),
        "actions": reports,
        "warnings": mapping["warnings"] + [
            "Pelvis and foot positions are diagnostic only; no ground calibration, contact acceptance, or IK was performed.",
            "Target GLB is not the pinned Blender .blend rig; this report cannot validate production retargeting.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": report["status"], "actions": len(reports), "mappedBones": len(pairs)}))


if __name__ == "__main__":
    main()
