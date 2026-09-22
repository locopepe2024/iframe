import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.apps.comic_gen.extraction_jobs import ExtractionJobs
from src.apps.comic_gen.models import ArtDirection, Character, DirectorProfile, Scene, Script
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
        preview_storyboard_analysis=lambda project, text: first,
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
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "原始剧本" in prompt
    assert '"name": "主播"' in prompt
    assert '"action_summary": "原镜头"' in prompt
    assert "1. 拆成两个镜头" in prompt and "2. 保留总时长" in prompt
    assert result[0]["action_summary"] == "修订镜头"
