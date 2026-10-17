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


def test_scene_structured_light_and_camera_are_versioned_without_changing_description(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    design = {
        "visual_notes": "Blue dusk street with a visible market crowd",
        "style": "Photorealistic historical town",
        "ambient_lighting": "Blue dusk across the street",
        "local_lighting": {"target": "distant sunset", "effect": "limited red rim light"},
        "reference_viewpoint": "street-level northbound view",
        "reference_framing": "foreground, midground and distance remain readable",
        "confirmed": True,
    }
    pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": design})
    assert scene.description == "A market street"
    assert scene.asset_design["design_revisions"][0]["design"]["local_lighting"] == design["local_lighting"]
    pipeline.update_asset_attributes("project", "street", "scene", {
        "asset_design": {**design, "ambient_lighting": "Late blue dusk", "confirmed": False},
    })
    assert scene.asset_design["design_revisions"][0]["design"]["ambient_lighting"] == design["ambient_lighting"]
    restored = ComicGenPipeline.__new__(ComicGenPipeline)
    restored.data_file = pipeline.data_file
    assert restored._load_data()["project"].scenes[0].asset_design == scene.asset_design


def test_scene_local_light_requires_a_target_and_prop_rejects_scene_fields(tmp_path):
    pipeline, scene, prop = make_pipeline(tmp_path)
    with pytest.raises(ValueError, match="needs a target"):
        pipeline.update_asset_attributes("project", "street", "scene", {
            "asset_design": {"visual_notes": "Blue street", "local_lighting": {"effect": "red glow"}},
        })
    with pytest.raises(ValueError, match="unknown fields"):
        pipeline.update_asset_attributes("project", "sword", "prop", {
            "asset_design": {"visual_notes": "Plain sword", "ambient_lighting": "blue dusk"},
        })
    assert scene.asset_design["design_revisions"] == []
    assert prop.asset_design["design_revisions"] == []
