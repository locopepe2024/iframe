"""Inspect a candidate Quaternius-to-white-model pose transfer in Blender."""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sole_contact_metrics import summarize_sole


def sole_regions(target):
    """Fixed vertex IDs selected from weighted foot geometry in reset rest pose."""
    regions = {}
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"
              and any(mod.type == "ARMATURE" and mod.object == target for mod in obj.modifiers)]
    if any(mod.type != "ARMATURE" for obj in meshes for mod in obj.modifiers if mod.show_viewport):
        raise ValueError("sole diagnostic requires armature-only modifier stacks for stable vertex IDs")
    for side in ("l", "r"):
        candidates = []
        names = {f"foot_{side}", f"toe_{side}", f"ankle_{side}", f"DEF_foot_{side}"}
        for mesh in meshes:
            groups = {g.index for g in mesh.vertex_groups if g.name in names}
            for vertex in mesh.data.vertices:
                if sum(g.weight for g in vertex.groups if g.group in groups) >= 0.5:
                    candidates.append((mesh, vertex.index, (mesh.matrix_world @ vertex.co).z))
        if not candidates:
            raise ValueError(f"no weighted foot vertices for {side}")
        floor = min(item[2] for item in candidates)
        regions[side] = [(mesh, index) for mesh, index, z in candidates if z <= floor+0.02]
    return regions


def evaluated_sole(regions):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = {}
    try:
        for points in regions.values():
            for obj, _ in points:
                if obj.name not in evaluated:
                    ev = obj.evaluated_get(depsgraph)
                    mesh = ev.to_mesh()
                    evaluated[obj.name] = (ev, mesh)
                    if len(mesh.vertices) != len(obj.data.vertices):
                        raise ValueError("sole evaluation changed mesh topology")
        return {side: [list(evaluated[obj.name][0].matrix_world @
                            evaluated[obj.name][1].vertices[index].co) for obj, index in points]
                for side, points in regions.items()}
    finally:
        for ev, _ in evaluated.values():
            ev.to_mesh_clear()


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


def load_target(path):
    if path.suffix.lower() == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(path))
        armatures = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
        if len(armatures) != 1:
            raise ValueError(f"expected one armature in {path.name}, found {len(armatures)}")
        return armatures[0]
    return import_armature(path)


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


def render_preview(source, output, feet=False, ground=False):
    for obj in source.children_recursive:
        if obj.type == "MESH":
            obj.hide_render = True
    camera_data = bpy.data.cameras.new("diagnostic-camera")
    camera = bpy.data.objects.new("diagnostic-camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (2.8, -4, 1.4) if feet else (3.4, -5.5, 2.3)
    focus = Vector((0, 0, 0.3 if feet else 0.95))
    camera.rotation_euler = (focus - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 1.25 if feet else 2.8
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.7, 0.7, 0.7)
    scene.display.shading.show_shadows = True
    plane = None
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
        plane = bpy.context.object
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    if plane:
        data = plane.data
        bpy.data.objects.remove(plane, do_unlink=True)
        bpy.data.meshes.remove(data)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)


def main():
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview-dir", type=Path)
    parser.add_argument("--sole-contact", action="store_true", help="Measure weighted sole-region geometry; no contact acceptance")
    parser.add_argument("--foot-pivot", choices=("foot", "ankle"), default="foot",
                        help="Diagnostic A/B: transfer source foot rotation at target ankle instead of mid-foot")
    parser.add_argument("--sequence-dir", type=Path, help="Render every inclusive frame in full-body and feet views")
    parser.add_argument("--actions", nargs="+", default=["Punch_Jab", "Punch_Cross", "Sword_Attack"],
                        help="Exact source action names to inspect; missing actions fail closed")
    parser.add_argument("--pelvis-translation", action="store_true",
                        help="Diagnostic only: transfer scaled world-space hips displacement from rest")
    args = parser.parse_args(raw)

    mapping = json.loads(args.mapping.read_text())
    if mapping.get("schema") != "director3d-bone-map.v1" or mapping.get("retargetStatus") != "unmapped":
        raise ValueError("candidate mapping schema or status is invalid")
    source_hash = require_hash(args.source, mapping["sourceSha256"])
    source_buffer = args.source.with_name("AnimationLibrary_Godot_Standard.bin")
    buffer_hash = require_hash(source_buffer, mapping["sourceBufferSha256"])
    target_hash = sha256(args.target)
    expected_target_hash = mapping.get("targetBlendSha256") if args.target.suffix.lower() == ".blend" else mapping["targetSha256"]
    if target_hash != expected_target_hash:
        raise ValueError(f"SHA-256 mismatch for {args.target.name}: {target_hash}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    if args.target.suffix.lower() == ".blend":
        target = load_target(args.target)
        source = import_armature(args.source)
    else:
        source = import_armature(args.source)
        target = load_target(args.target)
    pairs = [dict(item) for item in mapping["pairs"]]
    if args.foot_pivot == "ankle":
        for side, source_side in (("l", "L"), ("r", "R")):
            chain = [f"ankle_{side}", f"foot_{side}", f"DEF_foot_{side}", f"toe_{side}"]
            if any(name not in target.data.bones for name in chain):
                raise ValueError(f"missing explicit ankle chain: {side}")
            for parent, child in zip(chain, chain[1:]):
                if target.data.bones[child].parent != target.data.bones[parent]:
                    raise ValueError(f"unexpected ankle chain: {side}")
            ankle, foot = (target.data.bones[name] for name in chain[:2])
            if quaternion_angle(ankle.matrix_local.to_quaternion(), foot.matrix_local.to_quaternion()) > 0.01:
                raise ValueError(f"unaligned ankle/foot rest axes: {side}")
            selected = [item for item in pairs if item == {"source": f"DEF-foot.{source_side}", "target": f"foot_{side}"}]
            if len(selected) != 1:
                raise ValueError(f"missing explicit source foot pair: {side}")
            selected[0]["target"] = f"ankle_{side}"
    if len({item["target"] for item in pairs}) != len(pairs):
        raise ValueError("duplicate target bone in mapping")
    for item in pairs:
        if item["source"] not in source.pose.bones or item["target"] not in target.pose.bones:
            raise ValueError(f"missing mapped bone: {item}")

    source_rest = {item["source"]: source.data.bones[item["source"]].matrix_local.to_quaternion() for item in pairs}
    target_rest = {item["target"]: target.data.bones[item["target"]].matrix_local.to_quaternion() for item in pairs}
    regions = sole_regions(target) if args.sole_contact else None
    translation_calibration = {"enabled": args.pelvis_translation}
    if args.pelvis_translation:
        for rig in (source, target):
            for name in (("DEF-hips", "root") if rig == source else ("pelvis", "root")):
                if name not in rig.data.bones:
                    raise ValueError(f"missing calibration bone: {name}")
            _, _, scale = rig.matrix_world.decompose()
            if (not all(math.isfinite(value) and value > 0 for value in scale)
                    or max(scale)-min(scale) > 1e-6
                    or rig.matrix_world.to_3x3().determinant() <= 0):
                raise ValueError("pelvis translation requires uniform positive armature scale")
        if quaternion_angle(source.matrix_world.to_quaternion(), target.matrix_world.to_quaternion()) > 0.01:
            raise ValueError("pelvis translation requires aligned world orientations")
        source_hips_rest = source.matrix_world @ source.data.bones["DEF-hips"].head_local
        target_hips_rest = target.matrix_world @ target.data.bones["pelvis"].head_local
        source_root_rest = source.matrix_world @ source.data.bones["root"].head_local
        target_root_rest = target.matrix_world @ target.data.bones["root"].head_local
        source_height = (source_hips_rest-source_root_rest).length
        target_height = (target_hips_rest-target_root_rest).length
        if not all(math.isfinite(value) and value >= 1e-6 for value in (source_height, target_height)):
            raise ValueError("invalid rest hips/root calibration")
        translation_scale = target_height/source_height
        translation_calibration.update(scale=translation_scale, basis="world_rest_hips_displacement",
                                       sourceRestHipRootM=source_height, targetRestHipRootM=target_height,
                                       maxPositionResidualM=0.0, maxBasisChange=0.0)
    actions = list(dict.fromkeys(args.actions))
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
        sole_samples = {side: [] for side in ("l", "r")}
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
            if args.pelvis_translation:
                before_basis = {item["target"]: target.pose.bones[item["target"]].matrix.to_3x3().copy()
                                for item in pairs}
                source_hips = source.matrix_world @ source.pose.bones["DEF-hips"].head
                displacement = (source_hips-source_hips_rest)*translation_scale
                hips = target.pose.bones["pelvis"]
                desired = hips.matrix.copy()
                desired.translation = target.matrix_world.inverted() @ (target_hips_rest+displacement)
                hips.matrix = desired
                bpy.context.view_layer.update()
                actual = target.matrix_world @ hips.head
                residual = (actual-(target_hips_rest+displacement)).length
                if not math.isfinite(residual) or residual > 0.0001:
                    raise ValueError(f"pelvis translation residual: {name} frame {frame}: {residual}")
                translation_calibration["maxPositionResidualM"] = max(
                    translation_calibration["maxPositionResidualM"], residual)
                basis_change = max(abs(target.pose.bones[bone].matrix[row][col]-basis[row][col])
                                   for bone, basis in before_basis.items()
                                   for row in range(3) for col in range(3))
                if not math.isfinite(basis_change) or basis_change > 1e-5:
                    raise ValueError(f"pelvis translation changed bone basis: {name} frame {frame}")
                translation_calibration["maxBasisChange"] = max(
                    translation_calibration["maxBasisChange"], basis_change)
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
            if regions:
                for side, points in evaluated_sole(regions).items():
                    sole_samples[side].append({"frame": frame, "points": points})
            if args.sequence_dir:
                for view in ("body", "feet"):
                    folder = args.sequence_dir / name / view
                    folder.mkdir(parents=True, exist_ok=True)
                    render_preview(source, folder / f"{frame-start:04d}.png", feet=view == "feet", ground=True)
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
        if regions:
            reports[-1]["soleGeometry"] = {
                side: {**summarize_sole(sole_samples[side], bpy.context.scene.render.fps / bpy.context.scene.render.fps_base),
                       "selection": "rest weighted foot vertices, bottom 0.02m band, weight >= 0.5",
                       "vertices": [{"mesh": obj.name, "index": index} for obj, index in regions[side]]}
                for side in regions}

    report = {
        "schema": "director3d-retarget-diagnostic.v1",
        "status": "candidate_only",
        "mappingRevision": mapping["revision"],
        "mappingSha256": sha256(args.mapping),
        "sourceSha256": source_hash,
        "sourceBufferSha256": buffer_hash,
        "targetArtifact": args.target.name,
        "targetSha256": target_hash,
        "blenderVersion": bpy.app.version_string,
        "mappedBones": len(pairs),
        "footPivot": args.foot_pivot,
        "effectivePairs": pairs,
        "effectiveNeutralTargetBones": [name for name in mapping["neutralTargetBones"]
                                        if name not in {item["target"] for item in pairs}]
                                       + (["foot_l", "foot_r"] if args.foot_pivot == "ankle" else []),
        "pelvisTranslation": translation_calibration,
        "sourceBones": len(source.data.bones),
        "targetBones": len(target.data.bones),
        "sequenceRendered": bool(args.sequence_dir),
        "authoredFPS": "unverified",
        "actions": reports,
        "warnings": mapping["warnings"] + [
            "Mapping warnings describe the input map; effective pairs and neutral bones record diagnostic overrides.",
            "Pelvis and foot positions are diagnostic only; no ground calibration, contact acceptance, or IK was performed.",
            *([] if args.target.suffix.lower() == ".blend" else [
                "Target GLB is not the pinned Blender .blend rig; this report cannot validate production retargeting.",
            ]),
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": report["status"], "actions": len(reports), "mappedBones": len(pairs)}))


if __name__ == "__main__":
    main()
