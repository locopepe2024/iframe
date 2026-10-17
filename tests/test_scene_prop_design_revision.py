from threading import RLock

import pytest

from src.apps.comic_gen.models import GlobalAssetLibrary, Prop, Scene, Script
from src.apps.comic_gen.pipeline import ComicGenPipeline


def make_pipeline(tmp_path):
    scene = Scene(id="street", name="Long street", description="A market street")
    prop = Prop(id="sword", name="Sword", description="Plain sword")
    script = Script(id="project", title="Project", original_text="", scenes=[scene],
                    props=[prop], created_at=1, updated_at=1)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline.data_file = str(tmp_path / "projects.json")
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary()
    return pipeline, scene, prop


@pytest.mark.parametrize("kind,asset_id", [("scene", "street"), ("prop", "sword")])
def test_scene_prop_design_draft_and_confirmation_survive_reload(tmp_path, kind, asset_id):
    pipeline, scene, prop = make_pipeline(tmp_path)
    asset = scene if kind == "scene" else prop
    draft = {"visual_notes": "Blue stone and worn wood", "user_requirements": "Keep the blue tone",
             "unresolved": ["Exact width"], "confirmed": False}
    pipeline.update_asset_attributes("project", asset_id, kind, {"asset_design": draft})
    assert asset.asset_design["design_draft"] == draft
    assert asset.asset_design["design_revisions"] == []

    confirmed = {**draft, "unresolved": [], "confirmed": True}
    pipeline.update_asset_attributes("project", asset_id, kind, {"asset_design": confirmed})
    assert asset.asset_design["design_revisions"][0]["revision"] == 1
    assert asset.asset_design["design_revisions"][0]["design"]["visual_notes"] == draft["visual_notes"]

    reloaded = ComicGenPipeline.__new__(ComicGenPipeline)
    reloaded.data_file = pipeline.data_file
    restored = reloaded._load_data()["project"]
    loaded = restored.scenes[0] if kind == "scene" else restored.props[0]
    assert loaded.asset_design == asset.asset_design


def test_scene_prop_design_rejects_blank_confirmation_without_mutation(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    with pytest.raises(ValueError, match="concrete visual design"):
        pipeline.update_asset_attributes("project", "street", "scene", {
            "asset_design": {"visual_notes": " ", "confirmed": True},
        })
    assert scene.asset_design == {"design_draft": {}, "design_revisions": []}

    with pytest.raises(ValueError, match="unknown fields"):
        pipeline.update_asset_attributes("project", "street", "scene", {
            "asset_design": {"visual_notes": "Stone", "hidden_prompt": "red sunset"},
        })
    assert scene.asset_design == {"design_draft": {}, "design_revisions": []}
