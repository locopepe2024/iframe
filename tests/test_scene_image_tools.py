from pathlib import Path
from threading import RLock
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import GlobalAssetLibrary, ImageVariant, Scene, Script
from src.apps.comic_gen.pipeline import ComicGenPipeline, InvalidAssetReference
from src.apps.comic_gen.scene_image_tools import parse_scene_tool, scene_tool_prompt


def make_pipeline(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    source_file = tmp_path / "output" / "source.png"
    source_file.parent.mkdir()
    source_file.write_bytes(b"image")
    scene = Scene(id="scene", name="Scene", description="Original", owner_user_id="user", owner_profile_id="owner")
    scene.image_asset.variants.append(ImageVariant(id="source", url="source.png"))
    scene.image_asset.selected_id = "source"
    script = Script(id="project", title="Project", original_text="", scenes=[scene], created_at=1, updated_at=1, owner_user_id="user", owner_profile_id="owner")
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary()
    pipeline.asset_generation_tasks = {}
    pipeline._save_lock = RLock()
    pipeline._save_data = Mock()
    pipeline._save_library_data = Mock()
    pipeline._save_series_data = Mock()
    pipeline.effective_director_profile = lambda _script: None
    return pipeline, scene


def test_scene_tool_task_keeps_validated_parameters_and_server_prompt(tmp_path, monkeypatch):
    pipeline, scene = make_pipeline(tmp_path, monkeypatch)
    reference = {"asset_type": "scene", "asset_id": "scene", "variant_id": "source"}
    tool = {"kind": "camera", "yaw": 75, "pitch": -20, "focus": True, "focus_x": 30}
    reviewed_prompt = scene_tool_prompt(parse_scene_tool(tool))
    _, task_id = pipeline.create_asset_generation_task(
        "project", "scene", "scene", references=[reference], image_generation_mode="reference",
        prompt=reviewed_prompt, scene_tool=tool,
    )
    params = pipeline.asset_generation_tasks[task_id]["params"]
    assert params["scene_tool"]["yaw"] == 75
    assert params["references"] == [reference]
    assert "水平环绕 75°" in params["prompt"]
    assert params["prompt"] == reviewed_prompt
    assert scene.image_asset.selected_id == "source"


def test_scene_tool_execution_resolves_source_and_forwards_edit_settings(tmp_path, monkeypatch):
    pipeline, _scene = make_pipeline(tmp_path, monkeypatch)
    pipeline.asset_generator = Mock()
    monkeypatch.setattr("src.apps.comic_gen.pipeline.runtime_uniart_for_owner", lambda *_args: {})
    reference = {"asset_type": "scene", "asset_id": "scene", "variant_id": "source"}
    tool = {"kind": "lighting", "light_side": "left", "brightness": 70}
    _, task_id = pipeline.create_asset_generation_task(
        "project", "scene", "scene", references=[reference], image_generation_mode="reference",
        prompt=scene_tool_prompt(parse_scene_tool(tool)), scene_tool=tool,
    )
    pipeline.process_asset_generation_task(task_id)
    assert pipeline.asset_generation_tasks[task_id]["status"] == "completed"
    call = pipeline.asset_generator.generate_scene.call_args
    assert "左侧" in call.kwargs["prompt"]
    assert call.kwargs["reference_image_urls"] == [str(tmp_path / "output" / "source.png")]
    assert call.kwargs["scene_tool"]["brightness"] == 70
    assert call.kwargs["scene_tool_source_variant_id"] == "source"
    assert call.kwargs["image_generation_mode"] == "reference"


@pytest.mark.parametrize("tool, references", [
    ({"kind": "camera", "yaw": 181}, [{"asset_type": "scene", "asset_id": "scene", "variant_id": "source"}]),
    ({"kind": "lighting", "color": "invalid"}, [{"asset_type": "scene", "asset_id": "scene", "variant_id": "source"}]),
    ({"kind": "camera"}, [{"asset_type": "scene", "asset_id": "other", "variant_id": "source"}]),
    ({"kind": "camera"}, []),
])
def test_scene_tool_rejects_invalid_or_missing_source(tmp_path, monkeypatch, tool, references):
    pipeline, _scene = make_pipeline(tmp_path, monkeypatch)
    with pytest.raises((ValueError, InvalidAssetReference)):
        pipeline.create_asset_generation_task(
            "project", "scene", "scene", references=references,
            image_generation_mode="reference", scene_tool=tool,
        )
    assert not pipeline.asset_generation_tasks


def test_lighting_prompt_uses_reference_only_as_light_guide():
    tool = parse_scene_tool({"kind": "lighting", "light_side": "back", "brightness": 80, "rim_light": True})
    prompt = scene_tool_prompt(tool, has_lighting_reference=True)
    assert "后方" in prompt and "80%" in prompt and "轮廓光" in prompt
    assert "第二张图片仅供参考灯位" in prompt


def test_generated_tool_candidate_keeps_source_and_does_not_replace_selection(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    generator = AssetGenerator({"output_dir": str(tmp_path / "output")})
    fake_model = Mock()
    fake_model.generate.side_effect = lambda _prompt, output_path, **_kwargs: (Path(output_path).write_bytes(b"result") and output_path, 0.1)
    generator._get_model_for = lambda _name: fake_model
    scene = Scene(id="scene", name="Scene", description="Original")
    scene.image_asset.variants.append(ImageVariant(id="source", url="source.png"))
    scene.image_asset.selected_id = "source"
    tool = {"kind": "camera", "yaw": 30}
    generator.generate_scene(scene, prompt=scene_tool_prompt(parse_scene_tool(tool)), image_generation_mode="reference",
                             preserve_prompt=True, scene_tool=tool, scene_tool_source_variant_id="source")
    candidate = scene.image_asset.variants[0]
    assert candidate.scene_tool == {"kind": "camera", "yaw": 30}
    assert candidate.scene_tool_source_variant_id == "source"
    assert scene.image_asset.selected_id == "source"
