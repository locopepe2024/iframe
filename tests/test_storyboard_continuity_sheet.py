from threading import RLock

from src.apps.comic_gen.models import (
    GlobalAssetLibrary, Scene, Script, StoryboardFrame, StoryboardReferenceProjectionSnapshot,
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
