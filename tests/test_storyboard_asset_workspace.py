"""Project membership must constrain storyboard inputs, not candidate visibility."""

from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import Character, Scene, Prop, Script, Series, StoryboardFrame, GlobalAssetLibrary, ImageVariant
from src.apps.comic_gen.pipeline import ComicGenPipeline, StaleStoryboardDraftError
from src.apps.comic_gen.llm import ScriptProcessor


@pytest.fixture
def workspace():
    pipeline = object.__new__(ComicGenPipeline)
    script = Script(id="episode", title="Episode", original_text="A room.", owner_profile_id="owner", created_at=0, updated_at=0)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary(
        characters=[Character(id="global-person", name="Library person", description="GLOBAL PERSON", owner_profile_id="owner")],
        scenes=[Scene(id="global-room", name="Library room", description="GLOBAL ROOM", owner_profile_id="owner")],
        props=[Prop(id="global-prop", name="Library prop", description="GLOBAL PROP", owner_profile_id="owner")],
    )
    pipeline.script_processor = Mock()
    pipeline.get_effective_prompt = Mock(return_value="")
    return pipeline, script


@pytest.mark.parametrize("kind", ["characters", "scenes", "props"])
def test_storyboard_analysis_excludes_unimported_global_candidates(workspace, kind):
    pipeline, script = workspace
    _, entities, _ = pipeline.storyboard_analysis_context(script.id)
    assert entities[kind] == []
    # Character-workbench/import consumers retain their wider candidate pool.
    assert len(pipeline.resolve_episode_assets(script)[kind]) == 1


def test_storyboard_analysis_keeps_local_over_series_and_imported_copies(workspace):
    pipeline, script = workspace
    script.series_id = "series"
    script.characters = [Character(id="shared", name="Local", description="LOCAL"),
                         Character(id="imported-copy", name="Library person", description="IMPORTED")]
    series = Series(id="series", title="Series", owner_profile_id="owner", created_at=0, updated_at=0,
                    characters=[Character(id="shared", name="Shared", description="SERIES"),
                                Character(id="series-only", name="Library person", description="INHERITED")],
                    scenes=[Scene(id="series-room", name="Room", description="SERIES ROOM")],
                    props=[Prop(id="series-prop", name="Prop", description="SERIES PROP")])
    other = Series(id="other", title="Other", created_at=0, updated_at=0,
                   characters=[Character(id="other-person", name="Other", description="OTHER")])
    pipeline.series_store = {series.id: series, other.id: other}
    _, entities, _ = pipeline.storyboard_analysis_context(script.id)
    assert [(item["id"], item["description"]) for item in entities["characters"]] == [
        ("shared", "LOCAL"), ("imported-copy", "IMPORTED"), ("series-only", "INHERITED")]
    assert [item["id"] for item in entities["scenes"]] == ["series-room"]
    assert [item["id"] for item in entities["props"]] == ["series-prop"]


def test_storyboard_asset_context_uses_confirmed_design_and_marks_missing_variant(workspace):
    pipeline, script = workspace
    scene = Scene(id="shop", name="Grain shop", description="Shop")
    scene.asset_design = {
        "design_draft": {"asset_baseline": {"scene_identity": "unconfirmed shop"}},
        "design_revisions": [{"revision": 2, "design": {"asset_baseline": {
            "scene_identity": "confirmed shop", "environment": ["loft eave visible from entrance"],
        }}}],
    }
    scene.image_asset.variants = [ImageVariant(id="active", url="scene.png", media_id="media-shop")]
    scene.image_asset.selected_id = "active"
    prop = Prop(id="sword", name="Sword", description="Sword")
    prop.asset_design = {"design_draft": {"visual_notes": "unconfirmed gold"}, "design_revisions": []}
    prop.image_asset.selected_id = "deleted"
    script.scenes = [scene]
    script.props = [prop]

    _, entities, _ = pipeline.storyboard_analysis_context(script.id)
    assert entities["asset_library_context"] == [
        {"asset_type": "scene", "asset_id": "shop", "design_revision": 2,
         "visual_baseline": {"scene_identity": "confirmed shop", "environment": ["loft eave visible from entrance"]},
         "selected_variant": {"variant_id": "active", "media_id": "media-shop"}},
        {"asset_type": "prop", "asset_id": "sword",
         "selected_variant": {"variant_id": "deleted", "status": "missing"}},
    ]
    assert "unconfirmed" not in str(entities["asset_library_context"])


def test_storyboard_model_prompt_receives_asset_context_separately_from_entity_ids():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = ('{"frames":[{"scene_ref_name":"粮铺",'
                                      '"action_summary":"门前停步","visual_atmosphere":"黄昏",'
                                      '"character_acting":"回望","key_action_physics":"站定",'
                                      '"lighting":"侧光"}]}')
    processor.analyze_to_storyboard("店门前", {
        "characters": [], "scenes": [{"id": "shop", "name": "粮铺", "description": "店面"}], "props": [],
        "asset_library_context": [{"asset_type": "scene", "asset_id": "shop", "design_revision": 2,
                                   "visual_baseline": {"environment": ["可见阁楼屋檐"]}}],
    })
    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "<approved_asset_library_context>" in prompt
    assert "可见阁楼屋檐" in prompt
    assert "不表示图片已附件提交" in prompt


def test_script_storyboard_draft_expires_when_approved_asset_context_changes(workspace):
    pipeline, script = workspace
    script.scenes = [Scene(id="shop", name="Shop", description="Shop")]
    lineage = pipeline.storyboard_workflow_lineage(script.id, script.original_text, "script")
    pipeline.validate_storyboard_lineage(script.id, script.original_text, lineage)

    script.scenes[0].asset_design = {"design_draft": {}, "design_revisions": [{
        "revision": 1, "design": {"asset_baseline": {"scene_identity": "Grain shop"}},
    }]}
    with pytest.raises(StaleStoryboardDraftError, match="storyboard_asset_context_hash"):
        pipeline.validate_storyboard_lineage(script.id, script.original_text, lineage)


def test_script_storyboard_draft_expires_when_selected_variant_disappears(workspace):
    pipeline, script = workspace
    scene = Scene(id="shop", name="Shop", description="Shop")
    scene.image_asset.variants = [ImageVariant(id="view", url="view.png", media_id="media-view")]
    scene.image_asset.selected_id = "view"
    script.scenes = [scene]
    lineage = pipeline.storyboard_workflow_lineage(script.id, script.original_text, "script")

    scene.image_asset.variants = []
    with pytest.raises(StaleStoryboardDraftError, match="storyboard_asset_context_hash"):
        pipeline.validate_storyboard_lineage(script.id, script.original_text, lineage)
    _, entities, _ = pipeline.storyboard_analysis_context(script.id)
    assert entities["asset_library_context"][0]["selected_variant"] == {
        "variant_id": "view", "status": "missing",
    }


def test_refinement_does_not_resolve_legacy_global_only_frame_references(workspace):
    pipeline, script = workspace
    frame = StoryboardFrame(id="frame", action_description="A quiet room.",
                            character_ids=["global-person"], scene_id="global-room")
    script.frames = [frame]
    pipeline.script_processor.refine_frame_to_rich.return_value = None
    pipeline.refine_frame(script.id, frame.id)
    args = pipeline.script_processor.refine_frame_to_rich.call_args.args
    assert args[0]["character_names"] == []
    assert args[0]["scene_name"] is None
    assert args[1:3] == ([], [])


def test_render_preview_does_not_append_global_only_character_description(workspace):
    pipeline, script = workspace
    frame = StoryboardFrame(id="frame", action_description="A quiet room.", scene_id="global-room", character_ids=["global-person"])
    script.frames = [frame]
    result = pipeline.preview_storyboard_render_prompt(script.id, frame.id, "A quiet room.")
    assert "A quiet room" in result
    assert "Library person" not in result
    assert "GLOBAL PERSON" not in result


def test_batch_render_receives_project_assets_only(workspace):
    pipeline, script = workspace
    pipeline.storyboard_generator = Mock()
    pipeline.storyboard_generator.generate_storyboard.return_value = script
    pipeline._save_data = Mock()
    pipeline.generate_storyboard(script.id)
    assert pipeline.storyboard_generator.generate_storyboard.call_args.kwargs == {
        "characters": [], "scenes": [],
        "output_dir": pipeline._owner_output_dir(script, "storyboard"),
    }


def test_reviewed_analysis_cannot_bind_names_to_unimported_global_candidates(workspace):
    pipeline, script = workspace
    pipeline._save_data = Mock()
    pipeline.stamp_owned_children = Mock()
    pipeline.analyze_text_to_frames(script.id, script.original_text, draft=[{
        "scene_ref_name": "Library room", "character_ref_names": ["Library person"],
        "prop_ref_names": ["Library prop"], "action_summary": "A quiet room.", "duration": 5,
    }])
    assert script.frames[0].character_ids == []
    assert script.frames[0].prop_ids == []
    assert script.frames[0].scene_id != "global-room"
    pipeline.script_processor.analyze_to_storyboard.assert_not_called()


def test_preview_fingerprint_tracks_imported_assets_but_not_unimported_candidates(workspace):
    pipeline, script = workspace
    script.frames = [StoryboardFrame(id="frame", scene_id="global-room", action_description="Room",
                                     character_ids=["global-person"])]
    original = pipeline.storyboard_render_context_token(script.id, "frame")
    pipeline.library_store.characters[0].description = "CHANGED GLOBAL"
    assert pipeline.storyboard_render_context_token(script.id, "frame") == original
    script.characters = [pipeline.library_store.characters[0].model_copy(deep=True)]
    imported = pipeline.storyboard_render_context_token(script.id, "frame")
    assert imported != original
    script.characters[0].description = "CHANGED PROJECT"
    assert pipeline.storyboard_render_context_token(script.id, "frame") != imported


def test_single_render_keeps_complete_prompt_and_project_assets(workspace):
    pipeline, script = workspace
    script.frames = [StoryboardFrame(id="frame", scene_id="global-room", action_description="Room",
                                     character_ids=["global-person"])]
    pipeline._save_data = Mock()
    pipeline._register_storyboard_frame_media = Mock()
    pipeline.storyboard_generator = Mock()
    pipeline.generate_storyboard_render(script.id, "frame", None, "Visible final prompt", prompt_is_complete=True)
    args, kwargs = pipeline.storyboard_generator.generate_frame.call_args
    assert args[1:3] == ([], None)
    assert kwargs["prompt"] == "Visible final prompt"
    assert kwargs["preserve_prompt"] is True


def test_project_context_does_not_inherit_foreign_owner_series(workspace):
    pipeline, script = workspace
    script.series_id = "foreign"
    pipeline.series_store["foreign"] = Series(id="foreign", title="Foreign", created_at=0, updated_at=0,
        owner_profile_id="another-owner", characters=[Character(id="foreign-person", name="Other", description="OTHER")])
    _, entities, _ = pipeline.storyboard_analysis_context(script.id)
    assert entities["characters"] == []
