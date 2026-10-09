"""Headless integration check with known geometry; writes only to a temp dir."""

import hashlib
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_depth_reference import export_depth


def center(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    value = image.pixels[((height // 2) * width + width // 2) * 4]
    bpy.data.images.remove(image)
    return value


def main():
    root = Path(tempfile.mkdtemp(prefix="director-depth-check-"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 0.5
    camera_data = bpy.data.cameras.new("review-camera")
    camera = bpy.data.objects.new("review-camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -4))
    plane = bpy.context.object
    plane.keyframe_insert(data_path="location", frame=1)
    plane.location.z = -8
    plane.keyframe_insert(data_path="location", frame=2)
    scene.render.resolution_x = scene.render.resolution_y = 16
    scene.render.resolution_percentage = 100
    scene.frame_start, scene.frame_end = 1, 2
    source = root / "known-distance.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    options = SimpleNamespace(source_blend=str(source), output=str(root / "result"),
                              bundle=None, camera=None, near_m=0, far_m=10,
                              start_frame=None, end_frame=None)
    result = export_depth(options)
    assert result["camera"]["name"] == "review-camera"
    assert result["metersPerSceneUnit"] == 0.5
    assert result["frameRange"] == [1, 2]
    for index, expected in enumerate((2.0, 4.0)):
        metric = center(root / "result" / result["outputs"]["meters"][index])
        preview = center(root / "result" / result["outputs"]["preview"][index])
        assert abs(metric - expected) < 0.01, (metric, expected)
        assert abs(preview - expected / 10) < 0.01, (preview, expected / 10)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == checksum
    for changes in ({"near_m": 10, "far_m": 1}, {"camera": "missing"}):
        invalid = SimpleNamespace(**vars(options))
        invalid.output = str(root / ("invalid-" + next(iter(changes))))
        for name, value in changes.items():
            setattr(invalid, name, value)
        try:
            export_depth(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid input was accepted")
    print(json.dumps({"status": "passed", "artifacts": str(root),
                      "verifiedMeters": [2, 4], "previewRangeM": [0, 10]}))


if __name__ == "__main__":
    main()
