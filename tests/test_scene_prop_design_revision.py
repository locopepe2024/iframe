from threading import RLock

import pytest

from src.apps.comic_gen.models import GlobalAssetLibrary, Prop, Scene, Script, ShotVisualDesignSnapshot, ImageAsset, ImageVariant
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


def test_scene_prompt_sources_roundtrip_without_overwriting_description(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    workspace = {
        "settings_pending": True,
        "design": {"prompt": "Unpolished stone street", "mode": "text", "references": []},
        "ai": {"prompt": "AI stone street @Gate", "mode": "reference", "references": [
            {"asset_type": "scene", "asset_id": "gate", "variant_id": "v2"},
        ]},
    }
    pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
        "visual_notes": "Stone street", "prompt_workspace": workspace, "confirmed": True,
    }})
    reloaded = ComicGenPipeline.__new__(ComicGenPipeline)
    reloaded.data_file = pipeline.data_file
    saved = reloaded._load_data()["project"].scenes[0]
    assert saved.asset_design["design_draft"]["prompt_workspace"] == workspace
    assert saved.description == "A market street"
    assert saved.image_asset == scene.image_asset
    assert "prompt_workspace" not in saved.asset_design["design_revisions"][0]["design"]


@pytest.mark.parametrize("source", ["design", "ai"])
def test_scene_confirms_the_explicitly_selected_prompt_source(tmp_path, source):
    pipeline, scene, _ = make_pipeline(tmp_path)
    workspace = {"active_source": source,
                 "design": {"prompt": "Original street"}, "ai": {"prompt": "AI street"}}
    pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
        "visual_notes": "Editable panel notes", "prompt_workspace": workspace, "confirmed": True,
    }})
    assert scene.asset_design["design_draft"]["visual_notes"] == "Editable panel notes"
    confirmed = scene.asset_design["design_revisions"][-1]["design"]
    assert confirmed["visual_notes"] == workspace[source]["prompt"]
    assert "prompt_workspace" not in confirmed
    assert scene.description == "A market street"


def test_scene_cannot_confirm_an_empty_selected_ai_source(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    with pytest.raises(ValueError, match="Selected scene design source"):
        pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
            "visual_notes": "Panel notes", "confirmed": True, "prompt_workspace": {
                "active_source": "ai", "design": {"prompt": "Original"}, "ai": {"prompt": " "},
            },
        }})
    assert scene.asset_design == {"design_draft": {}, "design_revisions": []}


@pytest.mark.parametrize("workspace", [
    {"design": {"prompt": "original"}},
    {"design": {"prompt": 4}, "ai": {"prompt": "AI"}},
    {"design": {"prompt": "original"}, "ai": {"prompt": "x" * 30001}},
    {"design": {"mode": "automatic"}, "ai": {}},
    {"design": {"references": [{"asset_type": "scene", "asset_id": "gate"}]}, "ai": {}},
    {"design": {}, "ai": {}, "hidden_prompt": "injected"},
    {"design": {}, "ai": {}, "settings_pending": "false"},
])
def test_scene_rejects_invalid_prompt_workspace_before_mutation(tmp_path, workspace):
    pipeline, scene, _ = make_pipeline(tmp_path)
    with pytest.raises(ValueError):
        pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
            "visual_notes": "Street", "prompt_workspace": workspace, "confirmed": True,
        }})
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


def test_scene_visual_constraints_are_saved_and_versioned(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    design = {
        "visual_notes": "Autumn street with a busy crowd",
        "visual_constraints": {
            "key_light_direction": "side",
            "forbidden_light_directions": ["front", "back"],
            "visible_face_limit": 3,
            "secondary_people_view": "其他人物保持侧身或远景",
        },
        "confirmed": True,
    }
    pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": design})
    saved = scene.asset_design["design_revisions"][0]["design"]["visual_constraints"]
    assert saved == design["visual_constraints"]


@pytest.mark.parametrize("constraints, message", [
    ({"key_light_direction": "diagonal"}, "key_light_direction is invalid"),
    ({"forbidden_light_directions": ["unspecified"]}, "forbidden_light_directions is invalid"),
    ({"visible_face_limit": 51}, "visible_face_limit is invalid"),
    ({"visible_face_limit": True}, "visible_face_limit is invalid"),
    ({"secondary_people_view": "x" * 301}, "secondary_people_view must be bounded text"),
])
def test_scene_visual_constraints_reject_invalid_values_without_mutation(tmp_path, constraints, message):
    pipeline, scene, _ = make_pipeline(tmp_path)
    with pytest.raises(ValueError, match=message):
        pipeline.update_asset_attributes("project", "street", "scene", {
            "asset_design": {"visual_notes": "Street", "visual_constraints": constraints},
        })
    assert scene.asset_design["design_revisions"] == []


def test_shot_visual_preset_is_snapshot_and_apply_is_frame_owned(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    from src.apps.comic_gen.models import StoryboardFrame

    source = StoryboardFrame(id="frame-1", scene_id="street", action_description="first")
    target = StoryboardFrame(id="frame-2", scene_id="street", action_description="second")
    pipeline.scripts["project"].frames = [source, target]
    source.shot_visual_design = ShotVisualDesignSnapshot(
        visual_design={"lighting": "side", "visible_face_limit": 3},
        compiled_prompt="side light, no more than 3 visible faces",
    )
    source.rendered_image_asset = ImageAsset(variants=[ImageVariant(id="variant-1", url="output/storyboard/frame-1.webp")], selected_id="variant-1")
    preset = pipeline.save_shot_visual_preset("project", "frame-1", "长街侧面光", source_variant_id="variant-1")
    assert preset is not None
    applied = pipeline.apply_shot_visual_preset("project", "frame-2", preset.id, "parameters_with_reference")
    assert applied is not None
    assert applied.shot_visual_design.source_preset_id == preset.id
    assert applied.shot_visual_design.source_variant_id == "variant-1"
    assert applied.shot_visual_design.apply_mode == "parameters_with_reference"
    preset.visual_design["lighting"] = "mutated test value"
    assert applied.shot_visual_design.visual_design["lighting"] == "side"


def test_scene_asset_submission_snapshot_captures_structured_visual_design(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    scene.asset_design["design_draft"] = {
        "visual_notes": "Autumn street",
        "visual_constraints": {
            "key_light_direction": "side",
            "visible_face_limit": 3,
        },
    }
    snapshot = pipeline._asset_submission_snapshot(
        scene,
        "scene",
        prompt="Autumn street, side light",
        negative_prompt="",
        model_id="image-model",
        aspect_ratio="16:9",
        generation_type="all",
        image_generation_mode="text",
    )
    assert snapshot["visual_design"]["visual_constraints"]["visible_face_limit"] == 3


def test_scene_variant_visual_snapshot_is_projected_as_reusable_preset(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    scene.image_asset.variants = [ImageVariant(
        id="scene-variant-1",
        url="output/assets/scenes/street-1.webp",
        submission_snapshot={
            "positive_prompt": "cool side-lit autumn street",
            "selected_model_id": "image-model",
            "aspect_ratio": "16:9",
            "generation_type": "all",
            "image_generation_mode": "text",
            "visual_design": {"visual_constraints": {"key_light_direction": "side"}},
        },
    )]
    presets = pipeline.list_shot_visual_presets("project", "street")
    assert len(presets) == 1
    assert presets[0].source_asset_id == "street"
    assert presets[0].source_variant_id == "scene-variant-1"
    assert presets[0].name.endswith("变体 1")


def test_scene_prompt_layers_survive_reload_and_confirmed_snapshot(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    layers = {"version": 1,
              "lighting": {"source": "月光", "angles": {"azimuth": 90, "elevation": 25}, "fill": "不额外补光"},
              "camera": {"framing": "全景", "focal_length": "长焦观感", "depth_of_field": "深景深"},
              "composition": {"spatial_layers": "前中后景分层"}}
    pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
        "visual_notes": "Stone street", "prompt_layers": layers, "confirmed": True,
    }})
    restored = ComicGenPipeline.__new__(ComicGenPipeline)
    restored.data_file = pipeline.data_file
    saved = restored._load_data()["project"].scenes[0]
    assert saved.asset_design["design_draft"]["prompt_layers"] == layers
    assert saved.asset_design["design_revisions"][0]["design"]["prompt_layers"] == layers
    assert "direction" not in saved.asset_design["design_draft"]["prompt_layers"]["lighting"]



@pytest.mark.parametrize("layers", [
    {"camera": {"brand": "hidden aesthetic"}},
    {"camera": {"framing": ["全景"]}},
    {"lighting": {"source": "x" * 501}},
    {"lighting": {"angles": {"azimuth": 0}}},
    {"lighting": {"angles": {"azimuth": 181, "elevation": 0}}},
    {"lighting": {"angles": {"azimuth": True, "elevation": 0}}},
    {"camera": {"angles": {"azimuth": 0, "elevation": 0}, "viewpoint": "侧面"}},
    {"lighting": {"angles": {"azimuth": 0, "elevation": 0}, "direction": "左侧"}},
    {"composition": {"continuity": "180 degree rule"}},
])
def test_scene_rejects_invalid_layers_before_mutation(tmp_path, layers):
    pipeline, scene, _ = make_pipeline(tmp_path)
    before = scene.model_dump()
    with pytest.raises(ValueError):
        pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
            "visual_notes": "Stone street", "prompt_layers": layers, "confirmed": True,
        }})
    assert scene.model_dump() == before


@pytest.mark.parametrize("light", [{"direction": "顶部来光"}, {"angles": {"azimuth": 0, "elevation": 75}}])
def test_scene_rejects_light_layer_contradicting_constraints(tmp_path, light):
    pipeline, scene, _ = make_pipeline(tmp_path)
    before = scene.model_dump()
    with pytest.raises(ValueError, match="conflicts"):
        pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
            "visual_notes": "Stone street", "prompt_layers": {"lighting": light},
            "visual_constraints": {"forbidden_light_directions": ["top"]},
        }})
    assert scene.model_dump() == before


def test_scene_focus_roundtrip(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    focus = {"target": "门口石狮", "x": 30, "y": 65, "radius": 18}
    pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
        "visual_notes": "Stone street", "prompt_layers": {"camera": {"focus": focus}}, "confirmed": True,
    }})
    restored = ComicGenPipeline.__new__(ComicGenPipeline)
    restored.data_file = pipeline.data_file
    loaded = restored._load_data()["project"].scenes[0]
    assert loaded.asset_design["design_draft"]["prompt_layers"]["camera"]["focus"] == focus
    assert loaded.asset_design["design_revisions"][0]["design"]["prompt_layers"]["camera"]["focus"] == focus


@pytest.mark.parametrize("focus", [
    {}, {"target": " "}, {"x": 30}, {"y": 30}, {"radius": 18},
    {"x": 101, "y": 30}, {"x": 30, "y": -1}, {"x": True, "y": 30},
    {"x": 30.5, "y": 30}, {"x": "30", "y": 30},
    {"x": 30, "y": 30, "radius": 43}, {"target": "x" * 501},
    {"target": "gate", "world_distance": 10},
])
def test_scene_rejects_invalid_focus_before_mutation(tmp_path, focus):
    pipeline, scene, _ = make_pipeline(tmp_path)
    before = scene.model_dump()
    with pytest.raises(ValueError):
        pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
            "visual_notes": "Stone street", "prompt_layers": {"camera": {"focus": focus}}, "confirmed": True,
        }})
    assert scene.model_dump() == before


@pytest.mark.parametrize("focus", [None, {"target": "远处山门"}, {"x": 0, "y": 100}])
def test_scene_accepts_optional_focus_and_boundary_coordinates(tmp_path, focus):
    pipeline, scene, _ = make_pipeline(tmp_path)
    pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
        "visual_notes": "Stone street", "prompt_layers": {"camera": {"focus": focus}},
    }})
    assert scene.asset_design["design_draft"]["prompt_layers"]["camera"]["focus"] == focus


def test_scene_atmosphere_roundtrip_without_implicit_light_changes(tmp_path):
    pipeline, scene, _ = make_pipeline(tmp_path)
    lighting = {"source": "传统油灯照明", "mood": "宁静平和", "air": "稀薄雾气", "color": "暖光", "shadow": "自然接触阴影", "rim": "微弱轮廓光"}
    pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
        "visual_notes": "Stone street", "prompt_layers": {"lighting": lighting}, "confirmed": True,
    }})
    restored = ComicGenPipeline.__new__(ComicGenPipeline)
    restored.data_file = pipeline.data_file
    loaded = restored._load_data()["project"].scenes[0]
    assert loaded.asset_design["design_draft"]["prompt_layers"] == {"lighting": lighting}
    assert loaded.asset_design["design_revisions"][0]["design"]["prompt_layers"] == {"lighting": lighting}


@pytest.mark.parametrize("field", ["season", "time_of_day", "mood", "air", "color", "shadow", "rim"])
@pytest.mark.parametrize("bad_value", [["宁静"], "x" * 501, True])
def test_scene_atmosphere_validation_before_mutation(tmp_path, field, bad_value):
    pipeline, scene, _ = make_pipeline(tmp_path)
    before = scene.model_dump()
    with pytest.raises(ValueError):
        pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
            "visual_notes": "Stone street", "prompt_layers": {"lighting": {field: bad_value}},
        }})
    assert scene.model_dump() == before


def test_autumn_evening_skylight_roundtrip_and_tool_normalization(tmp_path):
    from src.apps.comic_gen.scene_prompt_layers import ScenePromptLayers, validate_tool_panel, compile_tool_panel
    pipeline, _, _ = make_pipeline(tmp_path)
    lighting = {"season": "秋天", "time_of_day": "傍晚", "source": "来自天空的环境光照明", "color": "冷蓝色"}
    pipeline.update_asset_attributes("project", "street", "scene", {"asset_design": {
        "visual_notes": "Stone street", "prompt_layers": {"lighting": lighting}, "confirmed": True,
    }})
    loaded = pipeline._load_data()["project"].scenes[0]
    assert loaded.asset_design["design_draft"]["prompt_layers"] == {"lighting": lighting}
    assert loaded.asset_design["design_revisions"][0]["design"]["prompt_layers"] == {"lighting": lighting}
    tool = ScenePromptLayers.model_validate({"lighting": {k: v for k, v in lighting.items() if k != "color"}})
    reparsed = ScenePromptLayers.model_validate(tool.model_dump())
    validate_tool_panel(reparsed, "lighting")
    assert compile_tool_panel(reparsed) == "光影：季节：秋天；时段：傍晚；光源：来自天空的环境光照明"
