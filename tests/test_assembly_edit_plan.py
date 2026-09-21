"""Assembly swimlane plan contract and owner/reference boundary tests."""

import time
import uuid
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from src.apps.comic_gen.models import (
    AssemblyClip,
    AssemblyEditPlan,
    AssemblyLane,
    AssemblyMarker,
    Script,
    StoryboardFrame,
    VideoTask,
    Series,
)
from src.apps.comic_gen.pipeline import (
    AssemblyPlanConflictError,
    AssemblyPlanValidationError,
    ComicGenPipeline,
)


@pytest.fixture
def pipeline(tmp_path):
    with patch("src.apps.comic_gen.pipeline.ScriptProcessor"), \
         patch("src.apps.comic_gen.pipeline.AssetGenerator"), \
         patch("src.apps.comic_gen.pipeline.StoryboardGenerator"), \
         patch("src.apps.comic_gen.pipeline.VideoGenerator"), \
         patch("src.apps.comic_gen.pipeline.AudioGenerator"), \
         patch("src.apps.comic_gen.pipeline.ExportManager"):
        result = ComicGenPipeline()
    result.data_file = str(tmp_path / "projects.json")
    result.series_data_file = str(tmp_path / "series.json")
    result.library_data_file = str(tmp_path / "library.json")
    result.scripts = {}
    result.series_store = {}
    return result


def _script(project_id: str, owner_profile_id: str | None = None) -> Script:
    now = time.time()
    frame_id = f"frame-{project_id}"
    task_id = f"task-{project_id}"
    frame = StoryboardFrame(id=frame_id, scene_id="scene-1")
    task = VideoTask(
        id=task_id,
        project_id=project_id,
        owner_profile_id=owner_profile_id,
        frame_id=frame_id,
        image_url="images/frame.png",
        prompt="a bounded shot",
        status="completed",
        video_url="videos/shot.mp4",
    )
    return Script(
        id=project_id,
        owner_profile_id=owner_profile_id,
        title=project_id,
        original_text="source",
        frames=[frame],
        video_tasks=[task],
        created_at=now,
        updated_at=now,
    )


def _video_clip(clip_id: str, project_id: str, start: int, end: int) -> AssemblyClip:
    return AssemblyClip(
        id=clip_id,
        timeline_start_ms=start,
        timeline_end_ms=end,
        source_project_id=project_id,
        source_episode_id=project_id,
        source_frame_id=f"frame-{project_id}",
        source_task_id=f"task-{project_id}",
        source_refs=[f"scene:{project_id}:1"],
    )


def test_three_segment_plan_defaults_to_60_seconds():
    plan = AssemblyEditPlan(
        id="sample-60s",
        scope="series",
        lanes=[
            AssemblyLane(
                id="video-main",
                kind="video",
                clips=[
                    _video_clip("ep1", "episode-1", 0, 20_000),
                    _video_clip("memory", "episode-2", 20_000, 40_000),
                    _video_clip("ep3", "episode-3", 40_000, 60_000),
                ],
            ),
            AssemblyLane(
                id="dialogue",
                kind="dialogue",
                allow_overlap=True,
                clips=[
                    AssemblyClip(
                        id="dialogue-a",
                        timeline_start_ms=0,
                        timeline_end_ms=22_000,
                        source_refs=["frame:episode-1:dialogue"],
                    ),
                    AssemblyClip(
                        id="dialogue-b",
                        timeline_start_ms=20_000,
                        timeline_end_ms=42_000,
                        source_refs=["frame:episode-2:dialogue"],
                    ),
                ],
            ),
        ],
        markers=[
            AssemblyMarker(
                id="memory-marker",
                time_ms=20_000,
                label="大学毕业到分手的回忆段",
                marker_type="memory",
                source_refs=["scene:episode-2:memory"],
            )
        ],
    )

    assert plan.target_duration_ms == 60_000
    assert [clip.timeline_end_ms for clip in plan.lanes[0].clips] == [20_000, 40_000, 60_000]
    assert plan.markers[0].marker_type == "memory"


def test_video_overlap_and_missing_source_refs_are_rejected():
    with pytest.raises(ValidationError, match="overlapping clips"):
        AssemblyEditPlan(
            id="overlap",
            scope="project",
            lanes=[
                AssemblyLane(
                    id="video",
                    kind="video",
                    clips=[
                        AssemblyClip(id="a", timeline_start_ms=0, timeline_end_ms=20_000, source_refs=["a"]),
                        AssemblyClip(id="b", timeline_start_ms=19_000, timeline_end_ms=30_000, source_refs=["b"]),
                    ],
                )
            ],
        )

    with pytest.raises(ValidationError, match="requires source_refs"):
        AssemblyEditPlan(
            id="no-source",
            scope="project",
            lanes=[
                AssemblyLane(
                    id="video",
                    kind="video",
                    clips=[AssemblyClip(id="a", timeline_start_ms=0, timeline_end_ms=20_000)],
                )
            ],
        )


def test_project_plan_round_trip_and_stale_revision(pipeline):
    project = _script("project-1")
    pipeline.scripts[project.id] = project
    plan = AssemblyEditPlan(
        id="project-plan",
        scope="project",
        lanes=[AssemblyLane(id="video", kind="video", clips=[_video_clip("shot", project.id, 0, 20_000)])],
    )

    saved = pipeline.save_assembly_plan("project", project.id, plan)
    assert saved.revision == 1
    assert pipeline.get_assembly_plan("project", project.id).id == "project-plan"

    edited = plan.model_copy(deep=True)
    edited.provenance = {"editor": "human"}
    updated = pipeline.save_assembly_plan("project", project.id, edited)
    assert updated.revision == 2
    assert project.assembly_plan.revision == 2

    with pytest.raises(AssemblyPlanConflictError, match="stale"):
        pipeline.save_assembly_plan("project", project.id, plan)


def test_series_plan_rejects_episode_outside_series(pipeline):
    series = Series(
        id="series-1",
        title="Series",
        episode_ids=["episode-1"],
        created_at=time.time(),
        updated_at=time.time(),
    )
    pipeline.series_store[series.id] = series
    pipeline.scripts["episode-1"] = _script("episode-1")
    pipeline.scripts["episode-2"] = _script("episode-2")

    plan = AssemblyEditPlan(
        id="series-plan",
        scope="series",
        lanes=[
            AssemblyLane(
                id="video",
                kind="video",
                clips=[_video_clip("outside", "episode-2", 0, 20_000)],
            )
        ],
    )

    with pytest.raises(AssemblyPlanValidationError, match="outside series"):
        pipeline.save_assembly_plan("series", series.id, plan)


def test_series_plan_accepts_registered_episodes_and_preserves_legacy_none(pipeline):
    series = Series(
        id="series-1",
        title="Series",
        episode_ids=["episode-1", "episode-2"],
        created_at=time.time(),
        updated_at=time.time(),
    )
    pipeline.series_store[series.id] = series
    pipeline.scripts["episode-1"] = _script("episode-1")
    pipeline.scripts["episode-2"] = _script("episode-2")
    assert pipeline.get_assembly_plan("series", series.id) is None

    plan = AssemblyEditPlan(
        id="series-plan",
        scope="series",
        lanes=[
            AssemblyLane(
                id="video",
                kind="video",
                clips=[
                    _video_clip("one", "episode-1", 0, 20_000),
                    _video_clip("two", "episode-2", 20_000, 40_000),
                ],
            )
        ],
    )
    saved = pipeline.save_assembly_plan("series", series.id, plan)
    assert saved.scope == "series"
    assert series.assembly_plan.revision == 1

