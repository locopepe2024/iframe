from pathlib import Path
from threading import RLock
from unittest.mock import MagicMock
import time

from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import Character, Prop, Scene


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


def test_scene_scoped_image_remains_candidate_until_selected(tmp_path):
    model = FakeImageModel()
    generator = AssetGenerator({"output_dir": str(tmp_path / "assets")})
    generator._get_model_for = lambda _model_name: model
    scene = Scene(id="scene-draft", name="电影院冬季", description="冬季外景", episode_scene_id="scene-cinema")
    prop = Prop(id="prop-draft", name="电影票冬季", description="手持电影票", episode_scene_id="scene-cinema")

    generator.generate_scene(scene, prompt="电影院冬季外景")
    generator.generate_prop(prop, prompt="手持电影票")

    assert len(scene.image_asset.variants) == 1
    assert scene.image_asset.selected_id is None
    assert scene.image_url is None
    assert len(prop.image_asset.variants) == 1
    assert prop.image_asset.selected_id is None
    assert prop.image_url is None


def test_scene_scoped_character_reference_sheet_remains_candidate(tmp_path):
    model = FakeImageModel()
    generator = AssetGenerator({"output_dir": str(tmp_path / "assets")})
    generator._get_model_for = lambda _model_name: model
    character = Character(id="char-draft", name="周涵 · 街上", description="冬季外套", episode_scene_id="scene-street")

    generator.generate_character(character, generation_type="reference_sheet", prompt="周涵穿冬季外套", positive_prompt="")

    assert len(character.reference_sheet.image_variants) == 1
    assert character.reference_sheet.selected_image_id is None
    assert character.image_url is None


def test_pipeline_forwards_scene_prompt_to_generator():
    # Keep this test focused on the pipeline boundary: the prompt supplied by
    # the request must reach the scene generator rather than being dropped.
    from src.apps.comic_gen.pipeline import ComicGenPipeline
    from src.apps.comic_gen.models import Script

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
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
    pipeline._save_lock = RLock()
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
