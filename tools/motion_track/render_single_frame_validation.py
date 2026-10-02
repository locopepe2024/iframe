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
from mathutils import Vector


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--state", required=True)
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
    camera.location = (0, -9.5, 4.8)
    camera_data.lens = 36 / (2 * math.tan(math.radians(50) / 2))
    target = bpy.data.objects.new("single-frame-look-at", None)
    bpy.context.collection.objects.link(target)
    target.location = (0, 0, 1.25)
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
    meshes = []
    for source in source_meshes:
        mesh = source.copy()
        mesh.data = source.data.copy()
        mesh.name = "single-frame-" + source.name
        bpy.context.collection.objects.link(mesh)
        mesh.parent = arm
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


def apply_sample(root, arm, sample):
    root.location = Vector(sample.get("root_position") or (0, 0, 0))
    for name, values in (sample.get("joint_rotations_deg") or {}).items():
        bone = arm.pose.bones.get(name)
        if bone is None or len(values) != 3:
            continue
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = tuple(math.radians(float(v)) for v in values)
    bpy.context.view_layer.update()


def measure(arm, sample):
    expected = sample.get("joint_vectors") or {}
    mapping = {
        "upper_arm_l": ("upper_arm_l", "upper_arm_l"),
        "upper_arm_r": ("upper_arm_r", "upper_arm_r"),
        "lower_arm_l": ("lower_arm_l", "lower_arm_l"),
        "lower_arm_r": ("lower_arm_r", "lower_arm_r"),
        "upper_leg_l": ("upper_leg_l", "upper_leg_l"),
        "upper_leg_r": ("upper_leg_r", "upper_leg_r"),
        "lower_leg_l": ("lower_leg_l", "lower_leg_l"),
        "lower_leg_r": ("lower_leg_r", "lower_leg_r"),
        "pelvis": ("pelvis", "pelvis"),
        "spine_lower": ("spine_lower", "spine_lower"),
    }
    result = {}
    matrix = arm.matrix_world
    for key, (bone_name, expected_name) in mapping.items():
        bone = arm.pose.bones.get(bone_name)
        target = expected.get(expected_name)
        if bone is None or target is None:
            continue
        head = matrix @ bone.head
        tail = matrix @ bone.tail
        actual = tail - head
        result[key] = {
            "expected_vector": target,
            "actual_vector": list(actual.normalized()) if actual.length > 1e-8 else None,
            "direction_error_degrees": angle_deg(actual, target),
        }
    return result


def main():
    args = parse_args()
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    state = json.loads(Path(args.state).read_text())
    manifest = json.loads(Path(args.manifest).read_text())
    cases = manifest.get("cases", [])
    samples = (state.get("actors") or [{}])[1].get("motion_track", [])
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.source_blend).resolve()))
    setup_scene(out)
    source_arm = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    source_meshes = [obj for obj in bpy.data.objects if obj.type == "MESH" and any(m.type == "ARMATURE" for m in obj.modifiers)]
    for obj in list(bpy.data.objects):
        obj.hide_render = True
        obj.hide_viewport = True
    root, arm, meshes = clone_rig(source_arm, source_meshes)
    root.hide_render = False
    arm.hide_render = False
    for mesh in meshes:
        mesh.hide_render = False
    apply_materials(meshes)
    diagnostics = []
    for case in cases:
        frame = int(case["frame"])
        sample = min(samples, key=lambda item: abs(int(item.get("source_frame", item.get("frame", 1))) - frame))
        apply_sample(root, arm, sample)
        bpy.context.scene.render.filepath = str(out / f"blender-frame-{frame:04d}.png")
        bpy.ops.render.render(write_still=True)
        diagnostics.append({
            "source_frame": frame,
            "adapter_frame": sample.get("frame"),
            "matched_source_frame": sample.get("source_frame"),
            "bone_direction_errors": measure(arm, sample),
        })
    result = {
        "schema": "single-frame-blender-validation.v1",
        "source_blend": str(Path(args.source_blend).name),
        "source_manifest": str(Path(args.manifest).name),
        "evidence_boundary": {
            "observed": ["single-frame rig pose and bone direction measurements"],
            "not_proven": ["temporal continuity", "dynamic root yaw", "true 3d depth", "lumbar landmark accuracy"],
        },
        "cases": diagnostics,
    }
    (out / "blender-validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"cases": len(diagnostics), "output": str(out)}))


if __name__ == "__main__":
    main()
