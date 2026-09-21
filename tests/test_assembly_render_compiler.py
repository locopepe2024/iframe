"""Assembly plan render compiler and endpoint contract tests."""

import os
import shutil
import subprocess
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from src.apps.comic_gen import api
from src.apps.comic_gen.models import (
    AssemblyClip,
    AssemblyEditPlan,
    AssemblyLane,
    Script,
    Series,
    StoryboardFrame,
    VideoTask,
)
from src.apps.comic_gen.pipeline import AssemblyPlanValidationError, ComicGenPipeline
from src.apps.studio_access import studio_owner_dir


@pytest.fixture
def pipeline(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
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


def _project(
    project_id: str,
    video_url: str,
    *,
    owner_profile_id: str | None = None,
) -> Script:
    now = time.time()
    frame_id = f"frame-{project_id}"
    task_id = f"task-{project_id}"
    return Script(
        id=project_id,
        owner_profile_id=owner_profile_id,
        title=project_id,
        original_text="source",
        frames=[
            StoryboardFrame(
                id=frame_id,
                scene_id="scene-1",
                selected_video_id=task_id,
            )
        ],
        video_tasks=[
            VideoTask(
                id=task_id,
                project_id=project_id,
                owner_profile_id=owner_profile_id,
                frame_id=frame_id,
                image_url="images/frame.png",
                prompt="bounded shot",
                status="completed",
                video_url=video_url,
            )
        ],
        created_at=now,
        updated_at=now,
    )


def _clip(
    project_id: str,
    start_ms: int,
    end_ms: int,
    *,
    source_start_ms: int = 0,
    source_end_ms: int | None = None,
) -> AssemblyClip:
    return AssemblyClip(
        id=f"clip-{project_id}",
        timeline_start_ms=start_ms,
        timeline_end_ms=end_ms,
        source_start_ms=source_start_ms,
        source_end_ms=source_end_ms,
        source_project_id=project_id,
        source_episode_id=project_id,
        source_frame_id=f"frame-{project_id}",
        source_task_id=f"task-{project_id}",
        source_refs=[f"task:{project_id}"],
    )


def _plan(scope: str, clips: list[AssemblyClip], duration_ms: int) -> AssemblyEditPlan:
    return AssemblyEditPlan(
        id=f"{scope}-render-plan",
        scope=scope,
        target_duration_ms=duration_ms,
        lanes=[AssemblyLane(id="video-main", kind="video", clips=clips)],
    )


def _fake_ffmpeg_run(command, **_kwargs):
    Path(command[-1]).write_bytes(b"rendered-video")

    class Result:
        returncode = 0
        stdout = b""
        stderr = b""

    return Result()


def test_project_plan_renders_contiguous_clips_and_persists_output(pipeline):
    owner = "profile-a"
    projects = []
    clips = []
    for index in range(3):
        project_id = f"episode-{index + 1}"
        relative = os.path.join(
            os.path.relpath(studio_owner_dir(owner), "output"),
            "video",
            f"source-{index + 1}.mp4",
        )
        source = Path("output") / relative
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"source")
        project = _project(project_id, relative, owner_profile_id=owner)
        projects.append(project)
        pipeline.scripts[project_id] = project
        clips.append(
            _clip(
                project_id,
                index * 20_000,
                (index + 1) * 20_000,
                source_start_ms=1_000,
                source_end_ms=21_000,
            )
        )

    project = projects[0]
    project.assembly_plan = _plan("project", [clips[0]], 20_000)

    with patch("src.apps.comic_gen.pipeline.get_ffmpeg_path", return_value="/usr/bin/ffmpeg"), \
         patch("src.apps.comic_gen.pipeline.subprocess.run", side_effect=_fake_ffmpeg_run) as run:
        rendered = pipeline.render_assembly_plan("project", project.id)

    assert rendered is project
    assert project.merged_video_url
    assert Path("output", project.merged_video_url).read_bytes() == b"rendered-video"
    command = run.call_args.args[0]
    assert command.count("-i") == 1
    assert "trim=start=1.000000:end=21.000000" in command[command.index("-filter_complex") + 1]
    assert command[-1].endswith(".mp4")


def test_series_plan_renders_three_episode_bookend_timeline(pipeline):
    owner = "profile-a"
    clips = []
    for index in range(3):
        project_id = f"episode-{index + 1}"
        relative = os.path.join(
            os.path.relpath(studio_owner_dir(owner), "output"),
            "video",
            f"episode-{index + 1}.mp4",
        )
        source = Path("output") / relative
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"source")
        pipeline.scripts[project_id] = _project(
            project_id,
            relative,
            owner_profile_id=owner,
        )
        clips.append(_clip(project_id, index * 20_000, (index + 1) * 20_000))

    series = Series(
        id="series-1",
        owner_profile_id=owner,
        title="Bookend sample",
        episode_ids=["episode-1", "episode-2", "episode-3"],
        assembly_plan=_plan("series", clips, 60_000),
        created_at=time.time(),
        updated_at=time.time(),
    )
    pipeline.series_store[series.id] = series

    with patch("src.apps.comic_gen.pipeline.get_ffmpeg_path", return_value="/usr/bin/ffmpeg"), \
         patch("src.apps.comic_gen.pipeline.subprocess.run", side_effect=_fake_ffmpeg_run) as run:
        rendered = pipeline.render_assembly_plan("series", series.id)

    assert rendered is series
    assert series.merged_video_url
    assert Path("output", series.merged_video_url).is_file()
    command = run.call_args.args[0]
    assert command.count("-i") == 3
    assert "concat=n=3:v=1:a=0[outv]" in command[command.index("-filter_complex") + 1]


def test_render_rejects_resource_owned_by_another_profile(pipeline):
    project = _project(
        "project-1",
        "video/source.mp4",
        owner_profile_id="profile-a",
    )
    project.assembly_plan = _plan(
        "project",
        [_clip("project-1", 0, 10_000)],
        10_000,
    )
    pipeline.scripts[project.id] = project

    with patch("src.apps.comic_gen.pipeline.subprocess.run") as run:
        with pytest.raises(AssemblyPlanValidationError, match="Project not found"):
            pipeline.render_assembly_plan(
                "project",
                project.id,
                owner_profile_id="profile-b",
            )
    run.assert_not_called()


@pytest.mark.parametrize(
    ("lanes", "message"),
    [
        (
            [
                AssemblyLane(
                    id="video",
                    kind="video",
                    clips=[_clip("project-1", 0, 10_000)],
                ),
                AssemblyLane(
                    id="dialogue",
                    kind="dialogue",
                    clips=[
                        AssemblyClip(
                            id="dialogue-1",
                            timeline_start_ms=0,
                            timeline_end_ms=10_000,
                            source_refs=["audio:dialogue-1"],
                        )
                    ],
                ),
            ],
            "audio lanes are not supported",
        ),
        (
            [
                AssemblyLane(
                    id="video",
                    kind="video",
                    clips=[_clip("project-1", 1_000, 10_000)],
                )
            ],
            "begin at 0",
        ),
    ],
)
def test_render_rejects_unsupported_or_gapped_plan_before_ffmpeg(
    pipeline,
    lanes,
    message,
):
    source = Path("output/video/source.mp4")
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"source")
    project = _project("project-1", "video/source.mp4")
    project.assembly_plan = AssemblyEditPlan(
        id="invalid-render",
        scope="project",
        target_duration_ms=10_000,
        lanes=lanes,
    )
    pipeline.scripts[project.id] = project

    with patch("src.apps.comic_gen.pipeline.subprocess.run") as run:
        with pytest.raises(AssemblyPlanValidationError, match=message):
            pipeline.render_assembly_plan("project", project.id)
    run.assert_not_called()


@pytest.mark.parametrize("video_url", ["https://example.test/source.mp4", "../outside.mp4"])
def test_render_rejects_remote_or_escaping_source_before_ffmpeg(
    pipeline,
    video_url,
):
    project = _project("project-1", video_url)
    project.assembly_plan = _plan(
        "project",
        [_clip("project-1", 0, 10_000)],
        10_000,
    )
    pipeline.scripts[project.id] = project

    with patch("src.apps.comic_gen.pipeline.subprocess.run") as run:
        with pytest.raises(AssemblyPlanValidationError, match="local|managed output"):
            pipeline.render_assembly_plan("project", project.id)
    run.assert_not_called()


def test_explicit_render_endpoints_are_registered():
    routes = {
        (route.path, method)
        for route in api.app.routes
        for method in (getattr(route, "methods", None) or [])
    }
    assert ("/projects/{script_id}/assembly-plan/render", "POST") in routes
    assert ("/series/{series_id}/assembly-plan/render", "POST") in routes


def test_real_ffmpeg_renders_three_segments_in_timeline_order(pipeline):
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        pytest.skip("FFmpeg and ffprobe are required for the Assembly smoke test")

    clips = []
    project_ids = []
    for index, color in enumerate(("red", "green", "blue")):
        project_id = f"episode-{index + 1}"
        relative = f"video/{color}.mp4"
        source = Path("output") / relative
        source.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"color=c={color}:s=160x90:d=1:r=24",
                "-an",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(source),
            ],
            check=True,
            capture_output=True,
        )
        pipeline.scripts[project_id] = _project(project_id, relative)
        project_ids.append(project_id)
        clips.append(
            _clip(
                project_id,
                index * 1_000,
                (index + 1) * 1_000,
                source_start_ms=0,
                source_end_ms=1_000,
            )
        )

    series = Series(
        id="series-real-ffmpeg",
        title="RGB timeline",
        episode_ids=project_ids,
        assembly_plan=_plan("series", clips, 3_000),
        created_at=time.time(),
        updated_at=time.time(),
    )
    pipeline.series_store[series.id] = series

    rendered = pipeline.render_assembly_plan("series", series.id)
    output = Path("output") / rendered.merged_video_url
    duration = float(subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip())
    assert duration == pytest.approx(3.0, abs=0.1)

    samples = []
    for timestamp in (0.5, 1.5, 2.5):
        pixel = subprocess.run(
            [
                ffmpeg,
                "-v",
                "error",
                "-ss",
                str(timestamp),
                "-i",
                str(output),
                "-vf",
                "scale=1:1",
                "-frames:v",
                "1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-",
            ],
            check=True,
            capture_output=True,
        ).stdout
        samples.append(tuple(pixel[:3]))

    assert samples[0][0] > samples[0][1] + 80
    assert samples[1][1] > samples[1][0] + 60
    assert samples[2][2] > samples[2][1] + 80
