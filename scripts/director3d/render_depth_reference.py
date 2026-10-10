"""Export metric Z depth and a fixed-range preview from existing geometry."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_full_motion_bundle import apply_bundle

def args():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-blend", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--bundle")
    parser.add_argument("--camera", help="Camera object name; defaults to scene camera")
    parser.add_argument("--near-m", type=float, default=0.5)
    parser.add_argument("--far-m", type=float, default=20.0)
    parser.add_argument("--start-frame", type=int)
    parser.add_argument("--end-frame", type=int)
    return parser.parse_args(raw)


def compositor(scene):
    if hasattr(scene, "compositing_node_group"):
        tree = bpy.data.node_groups.new("director-depth-compositor", "CompositorNodeTree")
        scene.compositing_node_group = tree
        return tree
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    return tree


def file_output(tree, output, prefix, socket, file_format):
    node = tree.nodes.new("CompositorNodeOutputFile")
    node.save_as_render = False
    if hasattr(node, "file_output_items"):
        node.directory = str(output)
        node.file_name = prefix + "####"
        node.format.media_type = "IMAGE"
        node.file_output_items.new("FLOAT", "depth")
    else:
        node.format.file_format = file_format
        node.format.color_mode = "BW"
        node.format.color_depth = "32" if file_format == "OPEN_EXR" else "16"
        node.base_path = str(output)
        node.file_slots[0].path = prefix
    node.format.file_format = file_format
    node.format.color_mode = "BW"
    node.format.color_depth = "32" if file_format == "OPEN_EXR" else "16"
    tree.links.new(socket, node.inputs[0])


def math_node(tree, operation, source, value):
    node = tree.nodes.new("ShaderNodeMath" if bpy.app.version >= (5, 0, 0) else "CompositorNodeMath")
    node.operation = operation
    tree.links.new(source, node.inputs[0])
    node.inputs[1].default_value = value
    return node.outputs[0]


def setup_depth(scene, output, near_m, far_m):
    scale = scene.unit_settings.scale_length
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError("scene unit scale must be positive")
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.render.use_compositing = True
    scene.view_layers[0].use_pass_z = True
    tree = compositor(scene)
    layers = tree.nodes.new("CompositorNodeRLayers")
    layers.layer = scene.view_layers[0].name
    meters = math_node(tree, "MULTIPLY", layers.outputs["Depth"], scale)
    file_output(tree, output, "depth-meters-", meters, "OPEN_EXR")
    preview = math_node(tree, "SUBTRACT", meters, near_m)
    preview = math_node(tree, "DIVIDE", preview, far_m - near_m)
    preview = math_node(tree, "MAXIMUM", preview, 0.0)
    preview = math_node(tree, "MINIMUM", preview, 1.0)
    file_output(tree, output, "depth-preview-", preview, "PNG")
    return scale


def camera_record(scene):
    camera = scene.camera.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data = camera.data
    return {
        "frame": scene.frame_current,
        "matrixWorld": [list(row) for row in camera.matrix_world],
        "type": data.type, "lensMm": data.lens,
        "sensorWidthMm": data.sensor_width, "sensorHeightMm": data.sensor_height,
        "sensorFit": data.sensor_fit, "orthoScale": data.ortho_scale,
        "shiftX": data.shift_x, "shiftY": data.shift_y,
        "clipStart": data.clip_start, "clipEnd": data.clip_end,
    }


def export_depth(parsed):
    if not (math.isfinite(parsed.near_m) and math.isfinite(parsed.far_m)
            and 0 <= parsed.near_m < parsed.far_m):
        raise ValueError("depth range must satisfy 0 <= near-m < far-m")
    source = Path(parsed.source_blend).resolve()
    output = Path(parsed.output).resolve()
    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("output directory must be empty")
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    if parsed.bundle:
        bundle = json.loads(Path(parsed.bundle).read_text())
        if bundle.get("schema") != "director-full-motion-bundle.v1":
            raise ValueError("unsupported motion bundle schema")
        armatures = [obj for obj in scene.objects if obj.type == "ARMATURE"]
        if len(armatures) != 1:
            raise ValueError("motion bundle requires exactly one armature")
        root = bpy.data.objects.new("depth-motion-root", None)
        scene.collection.objects.link(root)
        armatures[0].parent = root
        root.rotation_euler[2] = math.radians(float(bundle.get("facing_offset_deg", 0)))
        apply_bundle(bundle, armatures[0])
        scene.frame_start, scene.frame_end = bundle["frame_range"]
        scene.render.fps = int(bundle["fps"])
        scene.render.fps_base = 1
    if parsed.camera:
        scene.camera = scene.objects.get(parsed.camera)
    if scene.camera is None or scene.camera.type != "CAMERA":
        raise ValueError("an active or explicitly named scene camera is required")
    if parsed.start_frame is not None:
        scene.frame_start = parsed.start_frame
    if parsed.end_frame is not None:
        scene.frame_end = parsed.end_frame
    if scene.frame_end < scene.frame_start:
        raise ValueError("end frame must not precede start frame")
    scale = setup_depth(scene, output, parsed.near_m, parsed.far_m)
    records = []
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        records.append(camera_record(scene))
        bpy.ops.render.render()
    files = {"meters": sorted(p.name for p in output.glob("*.exr")),
             "preview": sorted(p.name for p in output.glob("*.png"))}
    if any(len(paths) != len(records) for paths in files.values()):
        raise RuntimeError("depth export did not produce both outputs for every frame")
    if hashlib.sha256(source.read_bytes()).hexdigest() != checksum:
        raise RuntimeError("source scene changed during export")
    manifest = {
        "schema": "director-depth-reference.v1", "status": "completed",
        "sourceBlendChecksum": checksum, "blenderVersion": bpy.app.version_string,
        "depthSemantics": "camera_ray_distance", "unit": "meter",
        "metersPerSceneUnit": scale,
        "preview": {"nearM": parsed.near_m, "farM": parsed.far_m,
                    "nearColor": "black", "farColor": "white"},
        "frameRange": [scene.frame_start, scene.frame_end],
        "fps": scene.render.fps / scene.render.fps_base,
        "resolution": [int(scene.render.resolution_x * scene.render.resolution_percentage / 100),
                       int(scene.render.resolution_y * scene.render.resolution_percentage / 100)],
        "pixelAspect": [scene.render.pixel_aspect_x, scene.render.pixel_aspect_y],
        "camera": {"name": scene.camera.name, "frames": records}, "outputs": files,
        "warnings": ["Background depth is not a measured surface.",
                     "Depth describes existing geometry; scene accuracy is not validated."],
    }
    (output / "depth-reference.v1.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    print(json.dumps(export_depth(args())))
