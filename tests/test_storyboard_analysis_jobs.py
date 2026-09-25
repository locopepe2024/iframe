import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.apps.comic_gen.extraction_jobs import ExtractionJobs
from src.apps.comic_gen.models import ArtDirection, Character, DirectorProfile, Scene, Script, StoryboardFrame
from src.apps.identity import UserContext


def wait_done(store, job):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        current = store.get("owner", "project", job["id"])
        if current["status"] != "running":
            return current
        time.sleep(0.01)
    raise AssertionError("storyboard analysis did not finish")


def test_storyboard_jobs_are_drafts_owner_scoped_and_refinable(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    source = Script(
        id="project", title="Ad", original_text="source", created_at=1, updated_at=1,
        owner_profile_id="owner", frames=[],
    )
    first = [{"action_summary": "主播举起产品", "duration": 5}]
    refined = [{"action_summary": "主播先看镜头，再举起产品", "duration": 5}]
    captured = {}
    pipeline = SimpleNamespace(
        scripts={"project": source},
        series_store={},
        script_processor=SimpleNamespace(
            llm=SimpleNamespace(provider="openai", _get_default_model=lambda: "test")
        ),
        storyboard_analysis_context=lambda project: (
            source, {"characters": [{"name": "主播"}]}, "prompt"
        ),
        storyboard_visual_style=lambda script: {
            "selected_style_id": "film-noir",
            "style_config": {"positive_prompt": "黑白电影质感"},
        },
        preview_storyboard_analysis=lambda project, text, **kwargs: first,
        refine_storyboard_analysis=lambda project, text, draft, instructions: (
            captured.update(text=text, draft=draft, instructions=instructions) or refined
        ),
    )
    user = UserContext("user", "owner", "", "")
    other = UserContext("other", "other", "", "")

    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / "storyboard-jobs.db", executor=executor)
        monkeypatch.setattr(api, "pipeline", pipeline)
        monkeypatch.setattr(api, "extraction_jobs", jobs)

        initial = api.start_storyboard_analysis(
            "project", api.AnalyzeToStoryboardRequest(text="source"), user
        )
        initial_done = wait_done(jobs, initial)
        assert initial_done["result"]["frames"] == first
        assert source.frames == []
        with pytest.raises(HTTPException) as denied:
            api.storyboard_analysis_status("project", initial["id"], other)
        assert denied.value.status_code == 404

        revision = api.start_storyboard_analysis_refinement(
            "project",
            api.StoryboardAnalysisRefineRequest(
                text="source", draft=first, instructions=["保留产品特写", "先增加眼神动作"]
            ),
            user,
        )
        revised_done = wait_done(jobs, revision)

    assert revised_done["result"]["frames"] == refined
    assert captured == {
        "text": "source",
        "draft": first,
        "instructions": ["保留产品特写", "先增加眼神动作"],
    }
    assert source.frames == []


def test_applying_explicit_storyboard_draft_skips_analysis_model(tmp_path):
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    script = Script(
        id="project", title="Ad", original_text="old", created_at=1, updated_at=1,
        owner_profile_id="owner",
        characters=[Character(id="host", name="主播", description="")],
        scenes=[Scene(id="studio", name="直播间", description="")],
        art_direction=ArtDirection(
            selected_style_id="film", style_config={},
            director_profile=DirectorProfile(revision=4, content_hash="director-4", confirmed_at=1),
        ),
    )
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.script_processor = Mock()
    pipeline.resolve_episode_assets = Mock(return_value={
        "characters": script.characters, "scenes": script.scenes, "props": [],
    })
    pipeline.get_effective_prompt = Mock(return_value="prompt")
    pipeline.stamp_owned_children = Mock()
    pipeline._save_data = Mock()
    draft = [{
        "scene_ref_name": "直播间",
        "character_ref_names": ["主播"],
        "prop_ref_names": [],
        "action_summary": "主播举起产品",
        "duration": 5,
    }]

    result = pipeline.analyze_text_to_frames("project", "new", draft)

    pipeline.script_processor.analyze_to_storyboard.assert_not_called()
    assert len(result.frames) == 1
    assert result.frames[0].action_description == "主播举起产品"
    assert result.frames[0].character_ids == ["host"]
    assert result.frames[0].director_profile_revision == 4
    assert result.frames[0].director_profile_hash == "director-4"
    pipeline._save_data.assert_called_once()


def test_storyboard_prefers_exact_temporal_character_variant():
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    base = Character(id="zhou-base", name="周涵", description="基础设计")
    college = Character(id="zhou-college", name="周涵（大学时期）", description="大学时期设计")
    scene = Scene(id="campus", name="大学校园", description="校园")
    script = Script(
        id="project", title="Story", original_text="source", created_at=1, updated_at=1,
        characters=[base, college], scenes=[scene], frames=[],
    )
    pipeline.scripts = {script.id: script}
    pipeline.storyboard_analysis_context = lambda project: (
        script,
        {"characters": [{"id": base.id, "name": base.name}, {"id": college.id, "name": college.name}]},
        "prompt",
    )
    pipeline.resolve_episode_assets = lambda current: {
        "characters": [base, college], "scenes": [scene], "props": [],
    }
    pipeline.stamp_owned_children = Mock()
    pipeline._save_data = Mock()
    pipeline.script_processor = Mock()

    result = pipeline.analyze_text_to_frames(
        "project",
        "大学时期的周涵走进校园。",
        draft=[{
            "scene_ref_name": "大学校园",
            "character_ref_names": ["周涵（大学时期）"],
            "prop_ref_names": [],
            "action_summary": "周涵走进校园",
            "duration": 5,
        }],
    )

    assert result.frames[0].character_ids == [college.id]


def test_storyboard_refinement_prompt_contains_source_entities_draft_and_history():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = '{"frames":[{"action_summary":"修订镜头"}]}'
    draft = [{"action_summary": "原镜头", "duration": 5}]

    result = processor.refine_storyboard_analysis(
        "原始剧本",
        {"characters": [{"name": "主播"}], "scenes": [], "props": []},
        draft,
        ["拆成两个镜头", "保留总时长"],
        visual_style={
            "selected_style_id": "film-noir",
            "style_config": {"positive_prompt": "黑白电影质感", "negative_prompt": "彩色"},
        },
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "原始剧本" in prompt
    assert '"name": "主播"' in prompt
    assert '"action_summary": "原镜头"' in prompt
    assert "1. 拆成两个镜头" in prompt and "2. 保留总时长" in prompt
    assert "黑白电影质感" in prompt and "彩色" in prompt
    assert "空间方位" in prompt and "对白原文" in prompt
    assert result[0]["action_summary"] == "修订镜头"


def test_storyboard_analysis_prompt_contains_project_visual_style():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = '{"frames":[{"action_summary":"角色推门进入"}]}'
    visual_style = {
        "selected_style_id": "film-noir",
        "style_config": {"positive_prompt": "黑白电影质感", "negative_prompt": "彩色"},
    }

    result = processor.analyze_to_storyboard(
        "角色推门进入。",
        {"characters": [], "scenes": [], "props": []},
        custom_extraction_prompt="Custom storyboard extraction rules",
        visual_style=visual_style,
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "Custom storyboard extraction rules" in prompt
    assert "黑白电影质感" in prompt and "彩色" in prompt
    assert "跨帧保持稳定" in prompt
    assert "空间方位" in prompt and "对白原文" in prompt
    assert result[0]["action_summary"] == "角色推门进入"


def test_long_storyboard_preview_resumes_ordered_source_batches():
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    script = Script(id="project", title="Story", original_text="", created_at=1, updated_at=1)
    pipeline.scripts = {script.id: script}
    pipeline.storyboard_analysis_context = lambda project: (script, {"characters": [], "scenes": [], "props": []}, "prompt")
    pipeline.script_processor = Mock()
    pipeline.script_processor.analyze_to_storyboard.side_effect = lambda text, *_args, **_kwargs: [{"action_summary": text[:8]}]
    source = "第一场。" * 1000
    saved = {}
    calls = []

    def save(index, source_ref, frames):
        saved[index] = {"source_ref": source_ref, "frames": frames}
        calls.append(index)
        return True

    first = pipeline.preview_storyboard_analysis("project", source, load_batches=lambda: {}, save_batch=save)
    assert len(first) > 1
    assert calls == list(range(len(first)))
    assert all(frame["source_ref"] == saved[index]["source_ref"] for index, frame in enumerate(first))

    pipeline.script_processor.analyze_to_storyboard.reset_mock()
    second = pipeline.preview_storyboard_analysis("project", source, load_batches=lambda: saved, save_batch=save)
    assert second == first
    pipeline.script_processor.analyze_to_storyboard.assert_not_called()


def test_rich_frame_prompt_keeps_project_style_and_continuity_constraints():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = '{"visual_description":"主播保持同一造型，接续举起产品。"}'

    result = processor.refine_frame_to_rich(
        {"action_summary": "主播举起产品"},
        [{"name": "主播", "clothing": "白衬衫"}],
        [{"name": "直播间"}],
        prev_frame_context="Action: 主播拿起产品。Screen direction: left to right.",
        next_frame_context="Action: 主播将产品放回桌面。",
        visual_style={"style_config": {"positive_prompt": "统一胶片质感"}},
        director_context="continuity_constraints: 保持白衬衫和人物朝向",
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "统一胶片质感" in prompt
    assert "保持白衬衫和人物朝向" in prompt
    assert "left to right" in prompt
    assert "将产品放回桌面" in prompt
    assert "preserve character appearance/clothing" in prompt
    assert result["visual_description"].startswith("主播保持同一造型")


def test_rich_frame_pipeline_forwards_style_and_confirmed_continuity():
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    character = Character(id="host", name="主播", description="主持人", clothing="白衬衫")
    scene = Scene(id="studio", name="直播间", description="固定布景")
    style = ArtDirection(
        selected_style_id="film", style_config={"positive_prompt": "统一胶片质感"},
        director_profile=DirectorProfile(
            continuity_constraints=["保持人物朝向和服装"], revision=2,
            content_hash="director-v2", confirmed_at=1,
        ),
    )
    previous = StoryboardFrame(
        id="previous", scene_id=scene.id, character_ids=[character.id],
        action_description="主播拿起产品", dialogue="看这里", visual_atmosphere="暖色顶光",
        shot_size="中景", camera_angle="平视",
    )
    current = StoryboardFrame(
        id="current", scene_id=scene.id, character_ids=[character.id],
        action_description="主播举起产品", shot_size="近景", camera_angle="平视",
    )
    following = StoryboardFrame(
        id="following", scene_id=scene.id, character_ids=[character.id],
        action_description="主播将产品放回桌面", shot_size="中景", camera_angle="平视",
    )
    script = Script(
        id="project", title="Story", original_text="source", created_at=1, updated_at=1,
        characters=[character], scenes=[scene], frames=[previous, current, following],
        art_direction=style,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_episode_assets = lambda _: {
        "characters": [character], "scenes": [scene], "props": [],
    }
    pipeline.script_processor = Mock()
    pipeline.script_processor.refine_frame_to_rich.return_value = None

    assert pipeline.refine_frame("project", "current") is current
    kwargs = pipeline.script_processor.refine_frame_to_rich.call_args.kwargs
    assert kwargs["visual_style"]["style_config"]["positive_prompt"] == "统一胶片质感"
    assert "保持人物朝向和服装" in kwargs["director_context"]
    assert "暖色顶光" in pipeline.script_processor.refine_frame_to_rich.call_args.args[3]
    assert "将产品放回桌面" in pipeline.script_processor.refine_frame_to_rich.call_args.args[4]


def test_storyboard_analysis_context_passes_project_style_to_all_frames():
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    style = ArtDirection(
        selected_style_id="film-noir",
        style_config={"positive_prompt": "黑白电影质感", "negative_prompt": "彩色"},
    )
    script = Script(
        id="project", title="Story", original_text="source", created_at=1, updated_at=1,
        art_direction=style,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.storyboard_analysis_context = lambda project: (
        script, {"characters": [], "scenes": [], "props": []}, "prompt"
    )
    pipeline.script_processor = Mock()
    pipeline.script_processor.analyze_to_storyboard.return_value = [
        {"action_summary": "角色推门进入"}
    ]

    result = pipeline.preview_storyboard_analysis("project", "source")

    assert result[0]["action_summary"] == "角色推门进入"
    pipeline.script_processor.analyze_to_storyboard.assert_called_once_with(
        "source",
        {"characters": [], "scenes": [], "props": []},
        custom_extraction_prompt="prompt",
        director_profile=None,
        visual_style={
            "selected_style_id": "film-noir",
            "style_config": {"positive_prompt": "黑白电影质感", "negative_prompt": "彩色"},
        },
    )


def test_storyboard_visual_style_inherits_series_art_direction():
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    style = ArtDirection(
        selected_style_id="film-noir",
        style_config={"positive_prompt": "黑白电影质感", "negative_prompt": "彩色"},
    )
    script = Script(
        id="project", title="Story", original_text="source", created_at=1, updated_at=1,
        series_id="series", art_direction=None,
    )
    series = SimpleNamespace(id="series", art_direction=style)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.series_store = {series.id: series}

    assert pipeline.storyboard_visual_style(script) == {
        "selected_style_id": "film-noir",
        "style_config": style.style_config,
    }


def test_storyboard_job_fingerprint_changes_when_project_style_changes(monkeypatch):
    from src.apps.comic_gen import api

    source = Script(
        id="project", title="Story", original_text="source", created_at=1, updated_at=1,
    )
    visual_style = {"selected_style_id": "film-noir", "style_config": {"positive_prompt": "黑白"}}
    pipeline = SimpleNamespace(
        storyboard_analysis_context=lambda project: (source, {"characters": []}, "prompt"),
        storyboard_visual_style=lambda script: visual_style,
        script_processor=SimpleNamespace(
            llm=SimpleNamespace(provider="openai", _get_default_model=lambda: "test")
        ),
    )
    monkeypatch.setattr(api, "pipeline", pipeline)

    first = api._storyboard_analysis_fingerprint("project", "source")
    visual_style["style_config"]["positive_prompt"] = "彩色复古胶片"
    second = api._storyboard_analysis_fingerprint("project", "source")

    assert first != second
