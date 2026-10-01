"""Compile a director-full-motion-bundle.v1 into a Blender preview.

This renderer is intentionally dumb: all retargeting has already happened in
the bundle. It only applies root positions and local quaternion channels to a
named armature and emits review artifacts.
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector


def args():
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--source-blend", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(raw)


def setup_scene(bundle, output):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = int(os.environ.get("DIRECTOR_EEVEE_RENDER_SAMPLES", "4"))
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.render.fps = int(bundle["fps"])
    scene.frame_start = int(bundle["frame_range"][0])
    scene.frame_end = int(bundle["frame_range"][1])
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.ffmpeg.ffmpeg_preset = "REALTIME"
    scene.render.ffmpeg.audio_codec = "NONE"
    scene.render.filepath = str(output / "white_model_video.mp4")
    if not scene.world:
        scene.world = bpy.data.worlds.new("director-world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.05, 0.09, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.55
    # The source rig is authored without a guaranteed lighting setup.  Add a
    # deterministic three point rig so review renders expose the silhouette
    # and joint motion instead of producing a near-black outline.
    for name, location, energy, size in (
        ("director-key", (3.5, -4.0, 5.5), 900.0, 4.0),
        ("director-fill", (-3.0, -2.0, 3.0), 500.0, 3.0),
        ("director-rim", (0.0, 3.5, 4.5), 700.0, 3.0),
    ):
        light = bpy.data.objects.get(name)
        if light is None:
            data = bpy.data.lights.new(name + "-data", "AREA")
            light = bpy.data.objects.new(name, data)
            bpy.context.collection.objects.link(light)
        light.location = location
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = size
        target = bpy.data.objects.get("director-camera-target")
        if target is not None:
            light.rotation_euler = (target.location - light.location).to_track_quat("-Z", "Y").to_euler()
    if not bpy.data.objects.get("director-camera"):
        camera_data = bpy.data.cameras.new("director-camera-data")
        camera = bpy.data.objects.new("director-camera", camera_data)
        bpy.context.collection.objects.link(camera)
        scene.camera = camera
        camera.location = (0, -5.2, 2.6)
        camera_data.lens = 55
        target = bpy.data.objects.new("director-camera-target", None)
        bpy.context.collection.objects.link(target)
        target.location = (0, 0, 1.0)
        for light_name in ("director-key", "director-fill", "director-rim"):
            light = bpy.data.objects.get(light_name)
            if light is not None:
                light.rotation_euler = (target.location - light.location).to_track_quat("-Z", "Y").to_euler()
        constraint = camera.constraints.new("TRACK_TO")
        constraint.target = target
        constraint.track_axis = "TRACK_NEGATIVE_Z"
        constraint.up_axis = "UP_Y"


def apply_bundle(bundle, armature):
    for frame_data in bundle["frames"]:
        frame = int(frame_data["frame"])
        root = armature.parent
        if root and frame_data.get("rootPosition") is not None:
            root.location = Vector(frame_data["rootPosition"])
            root.keyframe_insert(data_path="location", frame=frame)
        quaternions = dict(frame_data.get("localQuaternions") or {})
        pelvis = frame_data.get("pelvisQuaternion")
        if pelvis:
            quaternions["pelvis"] = pelvis
        for name, value in quaternions.items():
            pose_bone = armature.pose.bones.get(name)
            if pose_bone is None or not isinstance(value, list) or len(value) != 4:
                continue
            pose_bone.rotation_mode = "QUATERNION"
            pose_bone.rotation_quaternion = Quaternion((float(value[3]), float(value[0]), float(value[1]), float(value[2])))
            pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def main():
    parsed = args()
    output = Path(parsed.output)
    output.mkdir(parents=True, exist_ok=True)
    bundle = json.loads(Path(parsed.bundle).read_text())
    if bundle.get("schema") != "director-full-motion-bundle.v1":
        raise SystemExit("bundle schema must be director-full-motion-bundle.v1")
    bpy.ops.wm.open_mainfile(filepath=str(Path(parsed.source_blend).resolve()))
    setup_scene(bundle, output)
    armatures = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise SystemExit(f"expected one armature, found {len(armatures)}")
    armature = armatures[0]
    root = bpy.data.objects.new("director-motion-root", None)
    bpy.context.collection.objects.link(root)
    armature.parent = root
    root.rotation_euler[2] = math.radians(float(bundle.get("facing_offset_deg", 0.0)))
    apply_bundle(bundle, armature)
    bpy.context.scene.render.filepath = str(output / "white_model_video.mp4")
    bpy.ops.render.render(animation=True)
    bpy.context.scene.frame_set(int(bundle["frame_range"][0]))
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.filepath = str(output / "white_model_preview.png")
    bpy.ops.render.render(write_still=True)
    manifest = {
        "schema": "director-media-render-result.v1",
        "status": "completed",
        "requestId": bundle.get("request_id", "local-preview"),
        "outputs": {
            "whiteModelVideo": "white_model_video.mp4",
            "whiteModelPreview": "white_model_preview.png",
            "fullMotionBundle": "full_motion.bundle.json",
            "retargetManifest": "retarget_manifest.json",
        },
        "blenderVersion": bpy.app.version_string,
        "warnings": list(bundle.get("warnings", [])),
        "error": None,
    }
    (output / "full_motion.bundle.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n")
    (output / "retarget_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
