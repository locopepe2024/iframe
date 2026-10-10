"""Render a bounded director scene snapshot as a single-frame depth task."""
import argparse
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import bpy
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_depth_reference import export_depth


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    snapshot = json.loads(Path(args.snapshot).read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    for index, item in enumerate(snapshot["meshes"]):
        mesh = bpy.data.meshes.new(f"depth-mesh-{index}")
        mesh.from_pydata(item["positions"], [], item["triangles"])
        mesh.update()
        obj = bpy.data.objects.new(mesh.name, mesh)
        scene.collection.objects.link(obj)
    camera_data = bpy.data.cameras.new("submitted-camera")
    camera = bpy.data.objects.new("submitted-camera", camera_data)
    scene.collection.objects.link(camera)
    settings = snapshot["camera"]
    camera.matrix_world = Matrix(settings["matrixWorld"])
    camera_data.type = settings["type"]
    camera_data.clip_start = settings["near"]
    camera_data.clip_end = settings["far"]
    if camera_data.type == "PERSP":
        camera_data.sensor_fit = "VERTICAL"
        camera_data.sensor_height = 24
        import math
        camera_data.lens = 12 / math.tan(math.radians(settings["verticalFovDeg"]) / 2)
    else:
        camera_data.ortho_scale = settings["orthoHeight"] * max(1, settings["aspect"])
    scene.camera = camera
    scene.frame_start = scene.frame_end = snapshot["frame"]
    scene.render.fps = snapshot["fps"]
    scene.render.resolution_x = snapshot["width"]
    scene.render.resolution_y = snapshot["height"]
    scene.render.resolution_percentage = 100
    source = Path(args.snapshot).parent / "submitted-scene.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    result = export_depth(SimpleNamespace(source_blend=str(source), output=args.output,
        bundle=None, camera=None, near_m=snapshot["nearM"], far_m=snapshot["farM"],
        start_frame=None, end_frame=None))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
