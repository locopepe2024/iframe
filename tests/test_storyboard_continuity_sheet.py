from threading import RLock

import pytest

from src.apps.comic_gen.models import (
    AssetImageSubmissionSnapshot, Character, EpisodeCharacterUse, GlobalAssetLibrary, ImageVariant,
    Scene, Script, StoryboardFrame,
    StoryboardReferenceProjectionSnapshot,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline


def make_pipeline(tmp_path, frames, scenes):
    script = Script(id="project", title="Project", original_text="", frames=frames,
                    scenes=scenes, created_at=1, updated_at=1)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline.data_file = str(tmp_path / "projects.json")
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary()
    return pipeline, script


def frame(frame_id, scene_id, place=None, time_id=None, *, baseline=None, shot=None):
    return StoryboardFrame(
        id=frame_id, scene_id=scene_id, shot_id=frame_id,
        director_shot_context={
            "scene": {"place_continuity_id": place, "time_continuity_id": time_id},
            "shot": shot or {}, "lighting_baseline": baseline or {},
            "shooting_plan_revision": 2, "shooting_plan_hash": "plan-hash",
        },
    )


def test_sheet_compares_world_light_across_places_but_not_local_light(tmp_path):
    a = frame("a", "street", "street", "dusk", baseline={
        "story_time": "dusk", "weather": "clear", "lighting": {"key_source": "sun"},
    })
    b = frame("b", "shop", "shop", "dusk", baseline={
        "story_time": "dusk", "weather": "rain", "lighting": {"key_source": "lamp"},
    })
    pipeline, script = make_pipeline(tmp_path, [a, b], [Scene(id="street", name="街", description=""), Scene(id="shop", name="店", description="")])
    sheet = pipeline.storyboard_continuity_sheet(script.id)
    assert len(sheet["rows"]) == 2
    assert sheet["rows"][0]["fields"]["weather"]["source_kind"] == "plan_baseline"
    assert [(issue["field"], issue["scope"]) for issue in sheet["issues"]] == [
        ("weather", "same_time_different_place"),
    ]


def test_sheet_marks_same_place_local_conflict_and_target_override(tmp_path):
    baseline = {"story_time": "dusk", "lighting": {"key_source": "sun"}}
    a = frame("a", "street", "street", "dusk", baseline=baseline)
    b = frame("b", "street", "street", "dusk", baseline=baseline,
              shot={"lighting": {"key_source": "lantern"}})
    b.reference_visual_projection = StoryboardReferenceProjectionSnapshot.model_validate({
        "target_frame_id": "b", "target_scene_id": "street",
        "source_variant_id": "v1", "source_scene_design_revision": 1,
        "selected_fields": ["lighting"], "visual_design": {"lighting": {"key_source": "old lamp"}},
    })
    pipeline, script = make_pipeline(tmp_path, [a, b], [Scene(id="street", name="街", description="")])
    sheet = pipeline.storyboard_continuity_sheet(script.id)
    second = sheet["rows"][1]
    assert second["fields"]["key_source"]["value"] == "lantern"
    assert second["fields"]["key_source"]["source_kind"] == "plan_shot"
    assert second["reference"]["source_variant_id"] == "v1"
    assert second["reference"]["source_design_revision"] == 1
    assert any(issue["field"] == "key_source" and issue["scope"] == "same_place_time"
               for issue in sheet["issues"])


def test_sheet_does_not_infer_missing_continuity_ids(tmp_path):
    a = frame("a", "street", None, None, baseline={"weather": "clear"})
    b = frame("b", "street", None, None, baseline={"weather": "rain"})
    pipeline, script = make_pipeline(tmp_path, [a, b], [Scene(id="street", name="街", description="")])
    sheet = pipeline.storyboard_continuity_sheet(script.id)
    assert sheet["issues"] == []
    assert all(row["continuity_status"] == "unresolved" for row in sheet["rows"])


def test_sheet_reports_explicit_style_override_without_calling_it_a_failure(tmp_path):
    a = frame("a", "street", "street", "dusk")
    b = frame("b", "street", "street", "dusk")
    b.style_prompt_override = "ink wash"
    pipeline, script = make_pipeline(tmp_path, [a, b], [Scene(id="street", name="街", description="")])
    issues = pipeline.storyboard_continuity_sheet(script.id)["issues"]
    assert any(issue["field"] == "style" and issue["status"] == "explicit_override"
               and issue["scope"] == "project_style" for issue in issues)


def test_confirmed_scene_light_takes_priority_over_plan_baseline(tmp_path):
    scene = Scene(id="street", name="街", description="")
    scene.asset_design = {"design_revisions": [{"revision": 3, "design": {
        "lighting": {"key_source": "confirmed lantern", "weather": "clear"},
    }}]}
    shot = frame("a", "street", "street", "dusk", baseline={
        "weather": "rain", "lighting": {"key_source": "planned sun"},
    })
    pipeline, script = make_pipeline(tmp_path, [shot], [scene])
    fields = pipeline.storyboard_continuity_sheet(script.id)["rows"][0]["fields"]
    assert fields["weather"]["value"] == "clear"
    assert fields["weather"]["source_kind"] == "scene_design"
    assert fields["key_source"]["value"] == "confirmed lantern"
    assert fields["key_source"]["source_revision"] == 3


def test_confirmed_scene_style_and_shot_fields_have_distinct_sources(tmp_path):
    scene = Scene(id="street", name="街", description="")
    scene.asset_design = {"design_draft": {"style": "unconfirmed draft"},
                          "design_revisions": [{"revision": 4, "design": {"style": "写实电影", "ambient_lighting": "暮秋残阳"}}]}
    shot = frame("a", "street", "street", "dusk")
    shot.duration = 6
    shot.shot_size = "大远景"
    shot.camera_angle = "鸟瞰"
    shot.camera_movement_structured = {"primary": "static", "speed": "normal", "description": "固定机位"}
    shot.transition_hint = "硬切"
    pipeline, script = make_pipeline(tmp_path, [shot], [scene])
    fields = pipeline.storyboard_continuity_sheet(script.id)["rows"][0]["fields"]
    assert fields["style"] == {"value": "写实电影", "source_kind": "scene_design",
                               "source_id": "street", "source_revision": 4, "status": "confirmed"}
    assert fields["ambient_lighting"]["value"] == "暮秋残阳"
    for key, value in {"duration": 6, "shot_size": "大远景", "camera_angle": "鸟瞰",
                       "camera_movement": "固定机位", "transition_hint": "硬切"}.items():
        assert fields[key]["value"] == value
        assert fields[key]["source_kind"] == "frame"


def test_different_confirmed_scene_styles_are_not_project_conflicts(tmp_path):
    first = Scene(id="street", name="街", description="", asset_design={
        "design_revisions": [{"revision": 1, "design": {"style": "写实电影"}}],
    })
    second = Scene(id="dream", name="梦境", description="", asset_design={
        "design_revisions": [{"revision": 1, "design": {"style": "水墨梦境"}}],
    })
    pipeline, script = make_pipeline(tmp_path, [frame("a", "street"), frame("b", "dream")], [first, second])
    assert not [issue for issue in pipeline.storyboard_continuity_sheet(script.id)["issues"] if issue["field"] == "style"]


def test_confirmed_scene_geometry_enters_video_source_hash(tmp_path):
    scene = Scene(id="shop", name="粮铺", description="")
    scene.asset_design = {
        "design_draft": {"asset_baseline": {"fixed_geometry": ["未确认阁楼"]}},
        "design_revisions": [{"revision": 1, "design": {"asset_baseline": {
            "scene_identity": "长街中段粮铺", "fixed_geometry": ["临街门廊", "木柜台"],
            "fixed_landmarks": ["粮袋"], "materials": ["旧木材"],
            "time_baseline": "黄昏", "lighting_baseline": "侧光",
        }}}],
    }
    pipeline, script = make_pipeline(tmp_path, [frame("a", "shop")], [scene])
    before = pipeline.storyboard_continuity_sheet(script.id)["rows"][0]
    assert before["scene_baseline"] == {
        "scene_identity": "长街中段粮铺", "fixed_geometry": ["临街门廊", "木柜台"],
        "fixed_landmarks": ["粮袋"], "materials": ["旧木材"],
    }
    scene.asset_design["design_revisions"].append({"revision": 2, "design": {"asset_baseline": {
        "scene_identity": "长街中段粮铺", "fixed_geometry": ["临街门廊", "木柜台", "侧门"],
    }}})
    after = pipeline.storyboard_continuity_sheet(script.id)["rows"][0]
    assert after["scene_baseline"]["fixed_geometry"][-1] == "侧门"
    assert after["visual_source_hash"] != before["visual_source_hash"]


def test_video_source_hash_tracks_selected_character_media_and_design(tmp_path):
    character = Character(id="keeper", name="老掌柜", description="")
    character.character_design = {"design_revisions": [{"revision": 1, "design": {
        "identity": {"visual_notes": "灰白发髻"},
    }}]}
    character.reference_sheet.image_variants = [
        ImageVariant(id="a", url="a.png", media_id="media-a"),
        ImageVariant(id="b", url="b.png", media_id="media-b"),
    ]
    character.reference_sheet.selected_image_id = "a"
    shot = frame("shot", "shop")
    shot.character_ids = ["keeper"]
    pipeline, script = make_pipeline(tmp_path, [shot], [Scene(id="shop", name="粮铺", description="")])
    script.characters = [character]

    def source_hash():
        return pipeline.storyboard_continuity_sheet(script.id)["rows"][0]["visual_source_hash"]

    original = source_hash()
    shot.workbench_reference_variant_ids = {"keeper": ["b"]}
    selected = source_hash()
    assert selected != original
    character.reference_sheet.image_variants[1].media_id = "media-replaced"
    replaced = source_hash()
    assert replaced != selected
    character.character_design["design_revisions"].append({"revision": 2, "design": {
        "identity": {"visual_notes": "新增身份特征"},
    }})
    assert source_hash() != replaced


def test_image_and_video_use_design_revision_of_selected_character_variant(tmp_path):
    character = Character(id="keeper", name="老掌柜", description="旧自由描述")
    character.character_design = {
        "design_draft": {"identity": {"visual_notes": "未确认红发"}},
        "design_revisions": [
            {"revision": 1, "design": {"identity": {"visual_notes": "灰白发髻"},
                                       "look": {"visual_notes": "深褐长衣"},
                                       "field_answers": {"action": "踉跄倒地"}}},
            {"revision": 2, "design": {"identity": {"visual_notes": "全新黑发"}}},
        ],
    }
    character.reference_sheet.image_variants = [ImageVariant(
        id="old", url="old.png", media_id="old-media",
        submission_snapshot=AssetImageSubmissionSnapshot(
            positive_prompt="旧版角色", selected_model_id="image-model", aspect_ratio="16:9",
            generation_type="all", image_generation_mode="text", design_revision_at_submission=1,
        ),
    )]
    character.reference_sheet.selected_image_id = "old"
    shot = frame("shot", "shop")
    shot.character_ids = ["keeper"]
    pipeline, script = make_pipeline(tmp_path, [shot], [Scene(id="shop", name="粮铺", description="")])
    script.characters = [character]

    row = pipeline.storyboard_continuity_sheet(script.id)["rows"][0]
    preview = pipeline.preview_storyboard_render_prompt(script.id, shot.id, "老掌柜站在柜台前")
    assert row["asset_visual_context"] == "角色老掌柜：灰白发髻；深褐长衣"
    assert row["asset_visual_issues"] == []
    assert row["asset_visual_context"] in preview
    assert "全新黑发" not in preview
    assert "未确认红发" not in preview
    assert "踉跄倒地" not in preview
    assert "旧自由描述" not in preview

    character.character_design["design_revisions"] = character.character_design["design_revisions"][1:]
    changed = pipeline.storyboard_continuity_sheet(script.id)["rows"][0]
    assert changed["asset_visual_context"] == ""
    assert changed["asset_visual_issues"] == ["character:keeper:missing_design_revision"]
    assert changed["visual_source_hash"] != row["visual_source_hash"]
    with pytest.raises(ValueError, match="missing_design_revision"):
        pipeline.preview_storyboard_render_prompt(script.id, shot.id, "老掌柜站在柜台前")


def test_reviewed_episode_look_uses_selected_asset_instead_of_project_character(tmp_path):
    project_character = Character(id="keeper", name="老掌柜", description="")
    project_character.character_design = {"design_revisions": [{"revision": 1, "design": {
        "identity": {"visual_notes": "母版黑发"},
    }}]}
    selected_look = Character(id="keeper-old", name="老掌柜暮年造型", description="")
    selected_look.character_design = {"design_revisions": [{"revision": 1, "design": {
        "identity": {"visual_notes": "灰白发髻"},
    }}]}
    selected_look.reference_sheet.image_variants = [
        ImageVariant(id="old-look", url="old.png", media_id="old-media"),
    ]
    shot = frame("shot", "shop")
    shot.character_ids = ["keeper"]
    shot.character_use_ids = {"keeper": "look-use"}
    pipeline, script = make_pipeline(tmp_path, [shot], [Scene(id="shop", name="粮铺", description="")])
    script.characters = [project_character, selected_look]
    script.episode_character_uses = [EpisodeCharacterUse(
        use_id="look-use", project_character_id="keeper", label="暮年", source_pack_id="pack",
        source_pack_revision=1, source_design_revision=1, source_anchor_variant_id="old-look",
        selected_asset_id="keeper-old", selected_asset_revision=1,
        selected_variant_id="old-look", selected_media_id="old-media",
        selected_source_scope="project", selected_source_container_id=script.id,
    )]
    row = pipeline.storyboard_continuity_sheet(script.id)["rows"][0]
    assert row["asset_visual_context"] == "角色老掌柜暮年造型：灰白发髻"
    assert "母版黑发" not in row["asset_visual_context"]
    assert row["asset_visual_issues"] == []
