"""Render and measure representative single-frame motion-track poses in Blender.

This tool intentionally validates one pose at a time. It does not claim temporal
continuity, calibrated depth, or a solved dynamic root yaw.
"""
import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--state", help="Deprecated; cases come directly from manifest")
    p.add_argument("--mode", choices=("quaternion",), default="quaternion")
    p.add_argument("--depth-mode", choices=("estimated", "flatten"), default="estimated")
    p.add_argument("--axis-signs", default="1,1,1", help="source x,y,z signs before image-to-Blender mapping")
    p.add_argument("--no-render", action="store_true")
    p.add_argument("--source-blend", required=True)
    p.add_argument("--manifest", required=True)
    p.add_argument("--output", required=True)
    return p.parse_args(raw)


def setup_scene(out):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = int(os.environ.get("DIRECTOR_EEVEE_RENDER_SAMPLES", "4"))
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    world = scene.world or bpy.data.worlds.new("single-frame-world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.018, 0.04, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    floor_mat = bpy.data.materials.new("single-frame-floor")
    floor_mat.diffuse_color = (0.045, 0.055, 0.085, 1)
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, -0.1), scale=(5, 4, 0.1))
    bpy.context.object.data.materials.append(floor_mat)
    for name, loc, energy, color in [
        ("key", (-4, -4, 7), 5000, (0.8, 0.9, 1)),
        ("fill", (4, -1, 5), 3500, (1, 0.7, 0.8)),
        ("rim", (0, 5, 6), 4500, (0.8, 0.75, 1)),
    ]:
        light = bpy.data.lights.new(name, "POINT")
        light.energy = energy
        light.color = color
        obj = bpy.data.objects.new(name, light)
        bpy.context.collection.objects.link(obj)
        obj.location = loc
    camera_data = bpy.data.cameras.new("single-frame-camera-data")
    camera = bpy.data.objects.new("single-frame-camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.location = (0, -6, 1.1)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 3.6
    camera_data.lens = 36 / (2 * math.tan(math.radians(50) / 2))
    target = bpy.data.objects.new("single-frame-look-at", None)
    bpy.context.collection.objects.link(target)
    target.location = (0, 0, 1.1)
    constraint = camera.constraints.new("TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"


def clone_rig(source_arm, source_meshes):
    root = bpy.data.objects.new("single-frame-root", None)
    bpy.context.collection.objects.link(root)
    arm = source_arm.copy()
    arm.data = source_arm.data.copy()
    arm.name = "single-frame-armature"
    bpy.context.collection.objects.link(arm)
    arm.parent = root
    arm.animation_data_clear()
    arm.hide_viewport = False
    arm.hide_set(False)
    for bone in arm.pose.bones:
        while bone.constraints:
            bone.constraints.remove(bone.constraints[0])
    meshes = []
    for source in source_meshes:
        mesh = source.copy()
        mesh.data = source.data.copy()
        mesh.name = "single-frame-" + source.name
        bpy.context.collection.objects.link(mesh)
        mesh.parent = arm
        mesh.animation_data_clear()
        mesh.hide_viewport = False
        mesh.hide_set(False)
        mesh.matrix_parent_inverse = arm.matrix_world.inverted()
        for modifier in mesh.modifiers:
            if modifier.type == "ARMATURE":
                modifier.object = arm
        meshes.append(mesh)
    return root, arm, meshes


def apply_materials(objects):
    for obj in objects:
        if obj.type != "MESH":
            continue
        for material in obj.data.materials:
            if not material:
                continue
            material.use_nodes = True
            nodes = material.node_tree.nodes
            nodes.clear()
            output = nodes.new("ShaderNodeOutputMaterial")
            emission = nodes.new("ShaderNodeEmission")
            emission.inputs["Color"].default_value = (0.82, 0.87, 0.92, 1)
            emission.inputs["Strength"].default_value = 1.0
            material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])


def normalize(value):
    v = Vector(value)
    return v.normalized() if v.length > 1e-8 else None


def angle_deg(a, b):
    va, vb = normalize(a), normalize(b)
    if va is None or vb is None:
        return None
    return math.degrees(va.angle(vb))


SEGMENTS = {
    "spine_lower": ("hip_center", "shoulder_center"),
    "spine_mid": ("hip_center", "shoulder_center"),
    "spine_chest": ("hip_center", "shoulder_center"),
    "clavicle_l": ("shoulder_center", "left_shoulder"),
    "upper_arm_l": ("left_shoulder", "left_elbow"),
    "lower_arm_l": ("left_elbow", "left_wrist"),
    "clavicle_r": ("shoulder_center", "right_shoulder"),
    "upper_arm_r": ("right_shoulder", "right_elbow"),
    "lower_arm_r": ("right_elbow", "right_wrist"),
    "upper_leg_l": ("left_hip", "left_knee"),
    "lower_leg_l": ("left_knee", "left_ankle"),
    "foot_l": ("left_heel", "left_foot_index"),
    "upper_leg_r": ("right_hip", "right_knee"),
    "lower_leg_r": ("right_knee", "right_ankle"),
    "foot_r": ("right_heel", "right_foot_index"),
}


DEPTH_MODE = "estimated"
AXIS_SIGNS = (1.0, 1.0, 1.0)


def source_points(case):
    # Use the exact case, not a 24fps resampled neighbor. Recompute centers
    # from these same joints; old derived_body can predate smoothing.
    joints = {name: Vector((AXIS_SIGNS[0] * p[0],
                            AXIS_SIGNS[2] * (0.0 if DEPTH_MODE == "flatten" else p[2]),
                            AXIS_SIGNS[1] * -p[1]))
              for name, p in case.get("semantic_joints", {}).items()}
    for name, left, right in (("hip_center", "left_hip", "right_hip"),
                              ("shoulder_center", "left_shoulder", "right_shoulder")):
        if left in joints and right in joints:
            joints[name] = (joints[left] + joints[right]) * 0.5
    return joints


def body_frame(right, up):
    # Signed anatomical right axis and torso up, with Gram-Schmidt projection.
    z = up.normalized()
    x = right - z * right.dot(z)
    if up.length < 1e-8 or x.length < 1e-8:
        raise ValueError("degenerate body frame")
    x.normalize()
    y = z.cross(x).normalized()
    return Matrix((x, y, z)).transposed()


def apply_sample(root, arm, case):
    root.location = (0, 0, 0)
    root.rotation_euler = (0, 0, 0)
    for bone in arm.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    points = source_points(case)
    warnings = []
    expected = {}
    required = ("left_hip", "right_hip", "hip_center", "shoulder_center")
    if all(name in points for name in required):
        source_basis = body_frame(points["right_hip"] - points["left_hip"],
                                  points["shoulder_center"] - points["hip_center"])
        # Calibrate against this asset's actual anatomical hip axis and spine.
        left = arm.data.bones["upper_leg_l"].head_local
        right = arm.data.bones["upper_leg_r"].head_local
        lower = arm.data.bones["spine_lower"].head_local
        upper = arm.data.bones["spine_chest"].tail_local
        rest_basis = body_frame(right - left, upper - lower)
        pelvis = arm.pose.bones["pelvis"]
        target = (source_basis @ rest_basis.inverted()) @ pelvis.bone.matrix_local.to_3x3()
        pose = target.to_4x4()
        pose.translation = pelvis.matrix.translation
        pelvis.matrix = pose
        bpy.context.view_layer.update()
    else:
        warnings.append("missing body frame evidence")
    for name, (a, b) in SEGMENTS.items():
        bone = arm.pose.bones.get(name)
        if bone is None or a not in points or b not in points:
            warnings.append("missing segment " + name)
            continue
        target = points[b] - points[a]
        if target.length < 1e-8:
            warnings.append("degenerate segment " + name)
            continue
        target.normalize()
        # Convert the target into the current pose-bone basis, then apply only
        # the local swing. This preserves the rig's parent chain; a direct
        # world matrix replacement can double-apply parent rotations on child
        # bones and produce crossed forearms/legs.
        local = bone.matrix.to_3x3().inverted() @ target
        bone.rotation_quaternion = bone.rotation_quaternion @ Vector((0, 1, 0)).rotation_difference(local.normalized())
        bpy.context.view_layer.update()
        expected[name] = target
    # Center the fixed camera on the posed rig, without moving individual limbs.
    return expected, warnings


def measure(arm, expected):
    evaluated = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    result = {}
    for name, target in expected.items():
        bone = evaluated.pose.bones[name]
        actual = bone.tail - bone.head
        result[name] = {
            "expected_vector": list(target),
            "actual_vector": list(actual.normalized()),
            "direction_error_degrees": angle_deg(actual, target),
            "local_quaternion_wxyz": list(arm.pose.bones[name].rotation_quaternion),
        }
    return result


def project_pose(arm, camera, case):
    """Compare projected evaluated bone joints with source 2D points.

    A similarity fit removes camera framing and rig scale, but keeps relative
    joint layout, side assignment, and pose direction. This is independent of
    the bone-direction self-check because it starts from evaluated endpoints
    and ends in source image coordinates.
    """
    source = case.get("semantic_joints") or {}
    pairs = {
        "left_shoulder": ("upper_arm_l", "head"),
        "left_elbow": ("upper_arm_l", "tail"),
        "left_wrist": ("lower_arm_l", "tail"),
        "right_shoulder": ("upper_arm_r", "head"),
        "right_elbow": ("upper_arm_r", "tail"),
        "right_wrist": ("lower_arm_r", "tail"),
        "left_hip": ("upper_leg_l", "head"),
        "left_knee": ("upper_leg_l", "tail"),
        "left_ankle": ("lower_leg_l", "tail"),
        "right_hip": ("upper_leg_r", "head"),
        "right_knee": ("upper_leg_r", "tail"),
        "right_ankle": ("lower_leg_r", "tail"),
    }
    evaluated = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    raw = {}
    for name, (bone_name, endpoint) in pairs.items():
        if name not in source:
            continue
        bone = evaluated.pose.bones.get(bone_name)
        if bone is None:
            continue
        point = bone.head if endpoint == "head" else bone.tail
        ndc = world_to_camera_view(bpy.context.scene, camera, arm.matrix_world @ point)
        raw[name] = (float(ndc.x), float(ndc.y))
    common = [name for name in pairs if name in raw and name in source]
    if len(common) < 3:
        return {"status": "insufficient_points", "points": len(common)}
    target = [(float(source[n][0]), 1.0 - float(source[n][1])) for n in common]
    actual = [raw[n] for n in common]
    tx = sum(p[0] for p in target) / len(target)
    ty = sum(p[1] for p in target) / len(target)
    ax = sum(p[0] for p in actual) / len(actual)
    ay = sum(p[1] for p in actual) / len(actual)
    # 2D Procrustes similarity: target ~= scale * R(actual-center) + target-center.
    num_c = sum((u[0] - ax) * (v[0] - tx) + (u[1] - ay) * (v[1] - ty) for u, v in zip(actual, target))
    num_s = sum((u[0] - ax) * (v[1] - ty) - (u[1] - ay) * (v[0] - tx) for u, v in zip(actual, target))
    den = sum((u[0] - ax) ** 2 + (u[1] - ay) ** 2 for u in actual)
    if den < 1e-10:
        return {"status": "degenerate_projection", "points": len(common)}
    scale = math.sqrt(num_c * num_c + num_s * num_s) / den
    cos_r = num_c / math.sqrt(num_c * num_c + num_s * num_s) if num_c or num_s else 1.0
    sin_r = num_s / math.sqrt(num_c * num_c + num_s * num_s) if num_c or num_s else 0.0
    residuals = {}
    segment_errors = {}
    squared = 0.0
    for name, u, v in zip(common, actual, target):
        dx, dy = u[0] - ax, u[1] - ay
        fit = (tx + scale * (cos_r * dx - sin_r * dy), ty + scale * (sin_r * dx + cos_r * dy))
        error = math.sqrt((fit[0] - v[0]) ** 2 + (fit[1] - v[1]) ** 2)
        residuals[name] = error
        squared += error * error
    segment_pairs = {
        "upper_arm_l": ("left_shoulder", "left_elbow"),
        "lower_arm_l": ("left_elbow", "left_wrist"),
        "upper_arm_r": ("right_shoulder", "right_elbow"),
        "lower_arm_r": ("right_elbow", "right_wrist"),
        "upper_leg_l": ("left_hip", "left_knee"),
        "lower_leg_l": ("left_knee", "left_ankle"),
        "upper_leg_r": ("right_hip", "right_knee"),
        "lower_leg_r": ("right_knee", "right_ankle"),
    }
    for segment, (a, b) in segment_pairs.items():
        if a not in raw or b not in raw or a not in source or b not in source:
            continue
        # Compare after the same fitted similarity transform used for joint
        # residuals. This removes camera framing/scale while preserving the
        # segment's relative direction.
        ua, ub = Vector(raw[a]), Vector(raw[b])
        ta = Vector((scale * (cos_r * (ua.x - ax) - sin_r * (ua.y - ay)),
                     scale * (sin_r * (ua.x - ax) + cos_r * (ua.y - ay))))
        tb = Vector((scale * (cos_r * (ub.x - ax) - sin_r * (ub.y - ay)),
                     scale * (sin_r * (ub.x - ax) + cos_r * (ub.y - ay))))
        projected = tb - ta
        observed = Vector((float(source[b][0]) - float(source[a][0]),
                           -(float(source[b][1]) - float(source[a][1]))))
        if projected.length < 1e-8 or observed.length < 1e-8:
            continue
        angle_error = math.degrees(projected.angle(observed))
        if projected.cross(observed) < 0:
            angle_error *= -1
        segment_errors[segment] = {
            "angle_error_degrees": angle_error,
            "projected_length": projected.length,
            "source_length": observed.length,
            "length_ratio": projected.length / observed.length,
        }
    return {
        "status": "measured",
        "points": len(common),
        "similarity_scale": scale,
        "rmse_normalized_image": math.sqrt(squared / len(common)),
        "max_normalized_image_error": max(residuals.values()),
        "joint_errors": residuals,
        "segment_errors": segment_errors,
    }


def main():
    args = parse_args()
    global DEPTH_MODE
    global AXIS_SIGNS
    DEPTH_MODE = args.depth_mode
    AXIS_SIGNS = tuple(float(v) for v in args.axis_signs.split(","))
    if len(AXIS_SIGNS) != 3 or any(abs(v) != 1 for v in AXIS_SIGNS):
        raise SystemExit("--axis-signs must contain three values of 1 or -1")
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(Path(args.manifest).read_text())
    cases = manifest.get("cases", [])
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.source_blend).resolve()))
    for obj in list(bpy.data.objects):
        obj.hide_render = True
    setup_scene(out)
    source_arm = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    source_meshes = [obj for obj in bpy.data.objects if obj.type == "MESH" and any(m.type == "ARMATURE" for m in obj.modifiers)]
    root, arm, meshes = clone_rig(source_arm, source_meshes)
    root.hide_render = False
    arm.hide_render = False
    for mesh in meshes:
        mesh.hide_render = False
    apply_materials(meshes)
    diagnostics = []
    for case in cases:
        frame = int(case["frame"])
        expected, warnings = apply_sample(root, arm, case)
        if not args.no_render:
            bpy.context.scene.render.filepath = str(out / f"blender-frame-{frame:04d}.png")
            bpy.ops.render.render(write_still=True)
        diagnostics.append({
            "source_frame": frame,
            "adapter_frame": None,
            "matched_source_frame": frame,
            "warnings": warnings,
            "bone_direction_errors": measure(arm, expected),
            "projection_error": project_pose(arm, bpy.context.scene.camera, case),
        })
    result = {
        "schema": "single-frame-blender-validation.v1",
        "source_blend": str(Path(args.source_blend).name),
        "mode": "rest_calibrated_body_frame_local_swing",
        "coordinate_mapping": "source(x,y,z) -> blender(x,z,-y); depth uncalibrated",
        "source_manifest": str(Path(args.manifest).name),
        "evidence_boundary": {
            "observed": ["single-frame rig pose and bone direction measurements"],
            "not_proven": ["temporal continuity", "dynamic root yaw", "true 3d depth", "lumbar landmark accuracy", "axial twist", "visual match to source"],
        },
        "cases": diagnostics,
    }
    (out / "blender-validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"cases": len(diagnostics), "output": str(out)}))


if __name__ == "__main__":
    main()
