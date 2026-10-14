from pathlib import Path
from threading import RLock
from unittest.mock import MagicMock
import time

import pytest

from src.apps.comic_gen.assets import AssetGenerator


def test_seedream_asset_uses_nsfw_new_one_adapter(monkeypatch):
    from src.models.nsfw_new_one import NSFWNewOneImageModel

    monkeypatch.setenv("NSFW_NEW_ONE_BASE_URL", "http://172.17.0.1:3000/v1")
    monkeypatch.setattr(
        "src.apps.comic_gen.assets.studio_nsfw_new_one_config",
        lambda: {"api_key": "test-key", "base_url": "http://gateway.test/v1"},
    )
    generator = AssetGenerator()

    model = generator._get_model_for("nsfw/seedream_5.0Pro_nsfw")
    assert isinstance(model, NSFWNewOneImageModel)
    assert model.config["base_url"] == "http://172.17.0.1:3000/v1"
from src.apps.comic_gen.models import ModelSettings, Prop, Scene, Series


class FakeImageModel:
    def __init__(self):
        self.calls = []

    def generate(self, prompt, output_path, **kwargs):
        self.calls.append((prompt, kwargs))
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(b"fake-image")
        return output_path, 0.01


def test_scene_explicit_prompt_is_sent_and_recorded(tmp_path):
    model = FakeImageModel()
    generator = AssetGenerator({"output_dir": str(tmp_path / "assets")})
    generator._get_model_for = lambda _model_name: model
    scene = Scene(id="scene-1", name="旧名称", description="旧描述")

    generator.generate_scene(scene, prompt="中式茶事：实木茶桌上的黄连中药材")

    sent_prompt = model.calls[0][0]
    assert "中式茶事：实木茶桌上的黄连中药材" in sent_prompt
    assert "旧描述" not in sent_prompt
    assert scene.image_asset.variants[0].prompt_used == sent_prompt


def test_prop_explicit_prompt_is_sent_and_recorded(tmp_path):
    model = FakeImageModel()
    generator = AssetGenerator({"output_dir": str(tmp_path / "assets")})
    generator._get_model_for = lambda _model_name: model
    prop = Prop(id="prop-1", name="旧名称", description="旧描述")

    generator.generate_prop(prop, prompt="中式茶具：青花瓷茶壶与茶杯")

    sent_prompt = model.calls[0][0]
    assert "中式茶具：青花瓷茶壶与茶杯" in sent_prompt
    assert "旧描述" not in sent_prompt
    assert prop.image_asset.variants[0].prompt_used == sent_prompt


def test_pipeline_forwards_scene_prompt_to_generator():
    # Keep this test focused on the pipeline boundary: the prompt supplied by
    # the request must reach the scene generator rather than being dropped.
    from src.apps.comic_gen.pipeline import ComicGenPipeline
    from src.apps.comic_gen.models import Script

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    scene = Scene(id="scene-1", name="中式茶室", description="实木茶桌")
    now = time.time()
    script = Script(
        id="project-1",
        title="test",
        original_text="",
        scenes=[scene],
        created_at=now,
        updated_at=now,
    )
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.asset_generator = MagicMock()
    pipeline._save_after_asset_mutation = MagicMock()
    pipeline.effective_director_profile = lambda _script: None

    pipeline.generate_asset(
        script.id,
        scene.id,
        "scene",
        prompt="中式茶事：茶桌与黄连中药材",
        apply_style=False,
    )

    assert pipeline.asset_generator.generate_scene.call_args.kwargs["prompt"] == "中式茶事：茶桌与黄连中药材"


@pytest.mark.parametrize("asset_type", ["character", "scene", "prop"])
def test_asset_image_prompt_excludes_director_and_scene_style_context(asset_type):
    from src.apps.comic_gen.pipeline import ComicGenPipeline
    from src.apps.comic_gen.models import Character, Script

    asset = {
        "character": Character(id="asset-1", name="血狼", description="黑色作战服"),
        "scene": Scene(id="asset-1", name="天台", description="白天"),
        "prop": Prop(id="asset-1", name="狙击枪", description="黑色"),
    }[asset_type]
    script = Script(id="project-1", title="test", original_text="", created_at=0,
                    updated_at=0, **{asset_type + "s": [asset]})
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.asset_generation_tasks = {}
    pipeline.asset_generator = MagicMock()
    pipeline._save_after_asset_mutation = MagicMock()
    pipeline.effective_art_direction = lambda _script: MagicMock(style_config={
        "positive_prompt": "dense urban street, wet asphalt, neon signs",
        "negative_prompt": "",
    })
    pipeline.effective_director_profile = lambda _script: MagicMock(revision=2)
    pipeline.director_execution_context = MagicMock(return_value={
        "canon_state": {"events": ["sniper on rooftop"]},
        "execution_summary": "Hong Kong cinema mood",
    })
    pipeline.generation_lineage = MagicMock(return_value=MagicMock())
    pipeline._episode_asset_context_prompt = MagicMock(return_value="shooting plan rooftop scene")

    pipeline.generate_asset(script.id, asset.id, asset_type, prompt="isolated subject on white background",
                            style_prompt="neon signs", apply_style=True)

    call = getattr(pipeline.asset_generator, "generate_" + asset_type).call_args
    assert call.kwargs["prompt"] == "isolated subject on white background"
    if asset_type == "character":
        assert call.kwargs["positive_prompt"] == ""
    else:
        assert call.args[1] == ""
    assert pipeline.generation_lineage.call_args.args[1].revision == 2
    assert pipeline.generation_lineage.call_args.args[2]["canon_state"]


def test_scene_asset_context_is_projected_only_for_one_confirmed_scene():
    from src.apps.comic_gen.models import EpisodeVisualContext, EpisodeVisualSceneContext, Script
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    script = Script(id="project-1", title="test", original_text="", created_at=0, updated_at=0,
                    episode_visual_context=EpisodeVisualContext(
                        source_revision=1, director_profile_revision=1,
                        shooting_plan_revision=2, shooting_plan_hash="hash",
                        scenes=[EpisodeVisualSceneContext(
                            scene_id="plan-scene", scene_asset_id="scene-1",
                            location="青溪镇青石板长街", time_anchor="暮秋黄昏",
                            interior_exterior="室外", weather="晴朗",
                            atmosphere="人流繁杂，残阳将尽",
                        )],
                    ))
    prompt = ComicGenPipeline._episode_asset_context_prompt(script, "scene", "scene-1")
    assert "青溪镇青石板长街" in prompt
    assert "暮秋黄昏" in prompt
    assert "残阳将尽" in prompt
    assert "place_continuity_id" not in prompt


def test_video_polish_receives_only_selected_shot_context(monkeypatch):
    import json
    from src.apps.comic_gen.api import _get_director_prompt_context
    from src.apps.comic_gen.models import Script, StoryboardFrame

    selected = StoryboardFrame(id="frame-1", scene_id="scene-1", director_shot_context={
        "scene": {"scene_ref": "1-1 rooftop", "time_anchor": "day", "atmosphere": "unrelated long scene prose",
                  "place_continuity_id": "place-rooftop", "time_continuity_id": "time-dusk"},
        "shot": {"visual_intent": "sniper turns", "lighting": "daylight", "dialogue": "unrelated dialogue"},
        "lighting_baseline": {"place_continuity_id": "place-rooftop", "time_continuity_id": "time-dusk",
                              "daylight_phase": "late dusk", "weather": "clear",
                              "shadow_direction": "east", "lighting": {"key_source": "western sunset"}},
        "shooting_plan_revision": 3,
    })
    other = StoryboardFrame(id="frame-2", scene_id="scene-2", director_shot_context={
        "scene": {"scene_ref": "night club"}, "shot": {"visual_intent": "neon dance"},
    })
    script = Script(id="project-1", title="test", original_text="", frames=[selected, other],
                    created_at=0, updated_at=0)
    monkeypatch.setattr("src.apps.comic_gen.api.pipeline.get_script",
                        lambda ident: script if ident == script.id else None)

    context = _get_director_prompt_context(script.id, selected.id)
    assert "sniper turns" in context and "daylight" in context
    assert "western sunset" in context and "late dusk" in context
    assert "place-rooftop" in context and "time-dusk" in context
    assert "shooting_plan_revision" in context
    assert "neon dance" not in context
    assert "unrelated long scene prose" not in context
    assert "unrelated dialogue" not in context
    assert _get_director_prompt_context(script.id) == ""

    selected.director_shot_context["lighting_baseline"]["place_continuity_id"] = "place-other"
    mismatched = _get_director_prompt_context(script.id, selected.id)
    assert "western sunset" not in mismatched
    assert "sniper turns" in mismatched

    selected.director_shot_context["lighting_baseline"]["place_continuity_id"] = "place-rooftop"
    selected.director_shot_context["shot"]["ambient_sound"] = "风声" * 300
    selected.director_shot_context["shot"].update({
        "performance_action": "人物走动" * 80,
        "composition": "街景构图" * 80,
        "camera_movement": "缓慢横移" * 80,
    })
    bounded = _get_director_prompt_context(script.id, selected.id)
    assert len(bounded) <= 1200
    parsed = json.loads(bounded)
    assert parsed["scene"]["place_continuity_id"] == "place-rooftop"
    assert parsed["lighting_baseline"]["lighting"]["key_source"] == "western sunset"


def test_storyboard_render_projection_appends_only_current_shot_context():
    from src.apps.comic_gen.prompt_assembly import append_projected_shot_context

    context = {
        "scene": {
            "location": "青溪镇长街",
            "time_anchor": "暮秋黄昏",
            "continuity_in": "苏砚从梧桐树下进入",
            "continuity_out": "匪寇倒地",
        },
        "shot": {
            "visual_intent": "中远景展示人群裂开",
            "performance_action": "苏砚抬手卸械",
            "lighting": {"key_source": "右后方残阳", "color_tone": "暖红与冷灰并置"},
        },
    }
    prompt = append_projected_shot_context("青溪镇长街，中远景展示人群裂开。", context)
    assert prompt.count("青溪镇长街") == 1
    assert "暮秋黄昏" in prompt
    assert "苏砚抬手卸械" in prompt
    assert "暖红与冷灰并置" in prompt
    assert "canon_state" not in prompt


def test_series_asset_generation_uses_only_series_image_model():
    from src.apps.comic_gen.pipeline import ComicGenPipeline
    from src.apps.comic_gen.models import Script

    now = time.time()
    script = Script(id="episode-1", series_id="series-1", title="Episode", original_text="",
                    model_settings=ModelSettings(t2i_model="uniart/gpt-image-2"),
                    created_at=now, updated_at=now)
    series = Series(id="series-1", title="Series", model_settings=ModelSettings(
        t2i_model="uniart/gpt-image-2.5-flare-discount",
        i2i_model="uniart/gpt-image-2.5-flare-discount"), created_at=now, updated_at=now)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {series.id: series}
    pipeline.asset_generator = MagicMock()
    pipeline._save_after_asset_mutation = MagicMock()
    pipeline.effective_director_profile = lambda _script: None

    assert pipeline._asset_generation_model(script, "uniart/gpt-image-2") == "uniart/gpt-image-2.5-flare-discount"

    from src.apps.comic_gen.models import Character

    character = Character(id="character-1", name="Character", description="")
    script.characters = [character]
    pipeline._save_lock = RLock()
    pipeline.asset_generation_tasks = {}
    pipeline.generate_asset(
        script.id, character.id, "character", generation_type="full_body",
        reference_image_url="reference.png", image_generation_mode="reference",
    )

    generation = pipeline.asset_generator.generate_character.call_args.kwargs
    assert generation["model_name"] == "uniart/gpt-image-2.5-flare-discount"
    assert generation["i2i_model_name"] == "uniart/gpt-image-2.5-flare-discount"
