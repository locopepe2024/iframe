from threading import RLock

import pytest

from src.apps.comic_gen.models import GlobalAssetLibrary, Scene, Script, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline


SCENE_SPATIAL = {
    "schemaVersion": "iframe.scene-spatial.v1", "coordinateSystem": "z_up", "unit": "meter",
    "layoutId": "qingxi-street", "buildings": [{"id": "shop", "label": "Shop",
        "centerM": [0, 0, 0], "dimensionsM": [4, 5, 3], "frontSide": "positive_y"}],
    "anchors": [{"id": "shop-door", "buildingId": "shop", "positionM": [0, 2.5, 1]},
                {"id": "loft-window", "buildingId": "shop", "positionM": [1, 2.5, 2]}],
    "apertures": [],
}

SHOT_SPATIAL = {
    "schemaVersion": "iframe.shot-spatial.v1", "coordinateSystem": "z_up", "unit": "meter",
    "sceneId": "street", "sceneRevision": 1, "layoutId": "qingxi-street",
    "characters": [{"assetId": "lead", "revision": 2, "positionM": [1, -8, 0]}],
    "props": [],
    "cameras": [{"id": "near", "positionM": [2, -8, 1.6], "targetM": [0, 8, 4.8], "fovDeg": 35}],
    "requiredSightlines": [{"fromAnchorId": "shop-door", "toAnchorId": "loft-window"}],
}


def make_pipeline(tmp_path):
    scene = Scene(id="street", name="Street", description="Stone street", asset_design={
        "design_draft": {}, "design_revisions": [{"revision": 1, "design": {
            "visual_notes": "Stone street", "spatial_constraints": SCENE_SPATIAL,
        }}],
    })
    frame = StoryboardFrame(id="shot", scene_id="street", character_ids=["lead"])
    script = Script(id="project", title="Project", original_text="", scenes=[scene], frames=[frame],
                    created_at=1, updated_at=1)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline.data_file = str(tmp_path / "projects.json")
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary()
    return pipeline, frame


def test_shot_spatial_layout_survives_reload_and_clears_on_scene_change(tmp_path):
    pipeline, frame = make_pipeline(tmp_path)
    pipeline.update_frame("project", "shot", spatial_constraints=SHOT_SPATIAL)
    reloaded = ComicGenPipeline.__new__(ComicGenPipeline)
    reloaded.data_file = pipeline.data_file
    restored = reloaded._load_data()["project"].frames[0]
    assert restored.spatial_constraints.cameras[0].positionM == (2, -8, 1.6)
    assert restored.spatial_constraints.characters[0].assetId == "lead"
    pipeline.update_frame("project", "shot", scene_id="other")
    assert frame.spatial_constraints is None


def test_shot_spatial_rejects_wrong_scene_revision_and_invalid_camera(tmp_path):
    pipeline, frame = make_pipeline(tmp_path)
    with pytest.raises(ValueError, match="confirmed scene layout revision"):
        pipeline.update_frame("project", "shot", spatial_constraints={**SHOT_SPATIAL, "sceneRevision": 2})
    with pytest.raises(ValueError, match="Shot camera target"):
        pipeline.update_frame("project", "shot", spatial_constraints={**SHOT_SPATIAL, "cameras": [
            {"id": "near", "positionM": [0, 0, 1], "targetM": [0, 0, 1], "fovDeg": 35},
        ]})
    assert frame.spatial_constraints is None


def test_shot_spatial_rejects_unknown_sightline_anchor_and_unselected_prop(tmp_path):
    pipeline, frame = make_pipeline(tmp_path)
    with pytest.raises(ValueError, match="scene layout anchors"):
        pipeline.update_frame("project", "shot", spatial_constraints={**SHOT_SPATIAL,
            "requiredSightlines": [{"fromAnchorId": "missing", "toAnchorId": "shop-door"}]})
    with pytest.raises(ValueError, match="prop is not selected"):
        pipeline.update_frame("project", "shot", spatial_constraints={**SHOT_SPATIAL,
            "props": [{"assetId": "sword", "revision": 1, "positionM": [0, 0, 0]}]})
    assert frame.spatial_constraints is None


def test_shot_spatial_clears_when_selected_props_change(tmp_path):
    pipeline, frame = make_pipeline(tmp_path)
    pipeline.update_frame("project", "shot", spatial_constraints=SHOT_SPATIAL)
    pipeline.update_frame("project", "shot", prop_ids=["sword"])
    assert frame.spatial_constraints is None
