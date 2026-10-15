from unittest.mock import Mock
import threading

from src.apps.comic_gen.models import AssemblyClip, AssemblyEditPlan, AssemblyLane, Script, Series, StoryboardFrame, VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline


def setup_pipeline():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline._save_data = Mock()
    pipeline._save_series_data_unlocked = Mock()
    pipeline.series_store = {}
    clip = AssemblyClip(id="clip", timeline_start_ms=0, timeline_end_ms=2000,
        source_start_ms=1000, source_end_ms=3000, source_project_id="project",
        source_frame_id="frame", source_task_id="old", source_refs=["frame:frame"])
    plan = AssemblyEditPlan(scope="project", target_duration_ms=2000,
        lanes=[AssemblyLane(id="video", kind="video", clips=[clip])])
    project = Script(id="project", title="test", original_text="", created_at=0, updated_at=0,
        frames=[StoryboardFrame(id="frame", scene_id="scene", selected_video_id="old")],
        video_tasks=[VideoTask(id=ident, project_id="project", frame_id="frame", image_url="", prompt="test",
            status="completed", video_url=f"video/{ident}.mp4", created_at=index)
            for index, ident in enumerate(["old", "new"])], assembly_plan=plan)
    pipeline.scripts = {"project": project}
    return pipeline, project


def test_manual_take_change_updates_plan_reference_and_preserves_trims():
    pipeline, project = setup_pipeline()
    pipeline.select_video_for_frame("project", "frame", "new")
    clip = project.assembly_plan.lanes[0].clips[0]
    assert clip.source_task_id == "new"
    assert (clip.source_start_ms, clip.source_end_ms, clip.timeline_end_ms) == (1000, 3000, 2000)
    assert project.assembly_plan.revision == 2


def test_auto_selection_updates_plan_but_respects_pin_and_custom_reference():
    pipeline, project = setup_pipeline()
    project.frames[0].is_video_pinned = True
    pipeline.auto_select_latest_video("project", "frame")
    assert project.assembly_plan.revision == 1
    project.frames[0].is_video_pinned = False
    pipeline.auto_select_latest_video("project", "frame")
    assert project.assembly_plan.lanes[0].clips[0].source_task_id == "new"
    assert project.assembly_plan.revision == 2


def test_series_plan_follows_selection_with_owner_isolation():
    pipeline, project = setup_pipeline()
    plan = project.assembly_plan.model_copy(deep=True, update={"scope": "series"})
    series = Series(id="series", title="test", created_at=0, updated_at=0, assembly_plan=plan)
    foreign = Series(id="foreign", title="test", created_at=0, updated_at=0,
        owner_profile_id="other", assembly_plan=plan.model_copy(deep=True))
    pipeline.series_store = {"series": series, "foreign": foreign}
    pipeline.select_video_for_frame("project", "frame", "new")
    assert series.assembly_plan.lanes[0].clips[0].source_task_id == "new"
    assert series.assembly_plan.revision == 2
    assert foreign.assembly_plan.revision == 1
    pipeline._save_series_data_unlocked.assert_called_once()
    project.assembly_plan.lanes[0].clips[0].source_task_id = "custom"
    pipeline.select_video_for_frame("project", "frame", "old")
    assert project.assembly_plan.lanes[0].clips[0].source_task_id == "custom"
    assert project.assembly_plan.revision == 2
