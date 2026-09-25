import json
from threading import RLock
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from src.apps.comic_gen.llm import ScriptProcessor, split_director_source
from src.apps.comic_gen.models import (
    ArtDirection,
    Character,
    DirectorPlanBeat,
    DirectorPlanLighting,
    DirectorPlanShot,
    DirectorProfile,
    DirectorShootingPlan,
    DirectorStoryMap,
    Prop,
    Script,
    StoryboardFrame,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.structured_evidence import source_version

SOURCE_TEXT = "场景 6 电影院 日 内\n沈夏和周涵牵手走向入口。"


def story_map():
    return DirectorStoryMap(
        source_revision=1,
        source_revision_id=f"source-r1:{source_version(SOURCE_TEXT)}",
        people=[{"person_id": "shen-xia", "display_name": "沈夏", "variant_character_ids": ["shen-xia-young"]}],
        phases=[{
            "phase_id": "phase-campus",
            "order": 0,
            "label": "大学阶段",
            "time_anchor": "毕业前",
            "events": [{
                "event_id": "event-cinema",
                "order": 0,
                "title": "走向电影院",
                "description": "沈夏与周涵牵手走向电影院入口。",
                "character_ids": ["shen-xia-young"],
                "dramatic_function": "建立两人的亲密状态。",
                "source_fact_ids": [],
                "evidence_status": "interpretation",
            }],
        }],
    )


def make_pipeline():
    from src.apps.comic_gen.models import Scene

    frame = StoryboardFrame(id="old-frame", scene_id="cinema", action_description="legacy frame")
    character = Character(id="shen-xia-young", name="沈夏（大学）", description="温婉的大学生", persona="沈夏")
    prop = Prop(id="ticket", name="电影票", description="一张电影票")
    profile = DirectorProfile(
        revision=3,
        content_hash="director-hash-v3",
        story_map=story_map(),
        execution_summary="校园关系以自然克制的双人镜头表现。",
    )
    script = Script(
        id="film",
        title="校园恋情",
        original_text=SOURCE_TEXT,
        characters=[character],
        scenes=[Scene(id="cinema", name="电影院入口", description="电影院入口")],
        props=[prop],
        frames=[frame],
        source_revision=1,
        art_direction=ArtDirection(
            selected_style_id="restrained-film",
            style_config={"positive_prompt": "生活化爱情电影摄影"},
            director_profile=profile,
        ),
        created_at=1,
        updated_at=1,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline._save_data = Mock()
    pipeline.series_store = {}
    pipeline.scripts = {script.id: script}
    pipeline.resolve_episode_assets = Mock(return_value={
        "characters": [character], "scenes": script.scenes, "props": [prop],
    })
    pipeline.script_processor = Mock()
    return pipeline, script


def raw_shot(**overrides):
    return {
        "title": "双人跟拍",
        "visual_intent": "两人从电影院门口进入画面，入口灯箱形成视觉落点。",
        "performance_action": "两人轻松交谈，沈夏短暂看向周涵并微笑。",
        "action_physics": "周涵牵住沈夏的右手，两人同速向前走，衣袖随步伐摆动。",
        "shot_size": "中景",
        "camera_angle": "平视机位",
        "composition": "两人位于画面中央偏右，入口留在左后方。",
        "camera_movement": "稳定器缓慢向前跟拍。",
        "lighting": {
            "key_source": "入口左上方灯箱从侧前方照亮人物。",
            "color_tone": "室内暖色与室外冷色相接。",
            "contrast": "人物面部柔和明亮，背景入口略暗。",
            "practical_sources": ["电影院灯箱"],
        },
        "duration_seconds": 4,
        "dialogue": [],
        "ambient_sound": "门厅人声、检票提示音和轻微脚步声。",
        "character_ids": ["shen-xia-young"],
        "prop_ids": ["ticket"],
        **overrides,
    }


def raw_scene(**overrides):
    return {
        "scene_ref": "场景 6 电影院 日 内",
        "heading": "电影院入口",
        "location": "电影院入口",
        "time_anchor": "日间",
        "environment_atmosphere": "入口人流缓慢经过，灯箱和售票窗口呈现日常热闹感。",
        "prop_ids": ["ticket"],
        "unresolved_questions": [],
        "beats": [{
            "title": "并肩进场",
            "dramatic_purpose": "用自然的身体距离建立情侣关系。",
            "emotional_change": "亲密状态保持轻松稳定。",
            "story_event_ids": ["event-cinema"],
            "shots": [raw_shot()],
        }],
        **overrides,
    }


def valid_chunk(scene=None):
    return {"scenes": [scene or raw_scene()], "unresolved_questions": []}


def make_plan(pipeline):
    lineage = pipeline.director_shooting_plan_lineage("film")
    chunk = split_director_source(
        pipeline.scripts["film"].original_text,
        direct_max_chars=4500,
        target_chars=4000,
        max_chars=4500,
    )[0]
    scene = raw_scene()
    scene.update({
        "scene_id": "scene-cinema",
        "order": 0,
        "source_chunk_refs": [chunk["source_ref"]],
        "beats": [{
            **scene["beats"][0],
            "beat_id": "beat-entry",
            "order": 0,
            "shots": [{**raw_shot(), "shot_id": "shot-entry", "order": 0}],
        }],
    })
    return DirectorShootingPlan(**lineage, scenes=[scene], generated_at=10)


def test_plan_contract_is_strict_and_requires_contiguous_order_values():
    with pytest.raises(ValidationError, match="contiguous zero-based"):
        DirectorPlanBeat(
            beat_id="beat",
            order=0,
            shots=[DirectorPlanShot(shot_id="shot", order=1)],
        )
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        DirectorPlanLighting(key_source="window", surprise="ignored?")


def test_llm_retries_a_chunk_missing_visual_atoms_and_rejects_it_if_still_invalid():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    incomplete = valid_chunk()
    del incomplete["scenes"][0]["beats"][0]["shots"][0]["action_physics"]
    processor.llm.chat.side_effect = [
        json.dumps(incomplete, ensure_ascii=False),
        json.dumps(valid_chunk(), ensure_ascii=False),
    ]

    result = processor.plan_director_shooting_chunk(
        "场景 6 电影院 日 内\n两人牵手走向入口。",
        {"characters": [{"id": "shen-xia-young", "name": "沈夏（大学）"}], "props": []},
        {"story_map": {"phases": []}},
        {"style": "生活化电影"},
        source_ref="source:chars-0-20",
    )

    assert result["scenes"][0]["beats"][0]["shots"][0]["action_physics"]
    assert processor.llm.chat.call_count == 2
    retry_prompt = processor.llm.chat.call_args_list[1].kwargs["messages"][0]["content"]
    assert "source:chars-0-20" in retry_prompt
    assert "动作物理" in retry_prompt
    assert "action_physics" in retry_prompt
    assert "缺少字段：action_physics" in retry_prompt


def test_plan_lineage_rejects_director_or_style_changes_and_unknown_references():
    pipeline, script = make_pipeline()
    plan = make_plan(pipeline)

    profile = script.art_direction.director_profile
    profile.content_hash = "director-hash-v4"
    with pytest.raises(ValueError, match="lineage is stale: director_profile_hash"):
        pipeline._validate_director_shooting_plan(script, plan)

    profile.content_hash = "director-hash-v3"
    invalid = plan.model_dump()
    invalid["scenes"][0]["beats"][0]["story_event_ids"] = ["unknown-event"]
    with pytest.raises(ValueError, match="unknown Director story events"):
        pipeline._validate_director_shooting_plan(script, invalid)

    invalid = plan.model_dump()
    invalid["scenes"][0]["beats"][0]["shots"][0]["prop_ids"] = ["unknown-prop"]
    with pytest.raises(ValueError, match="unavailable props"):
        pipeline._validate_director_shooting_plan(script, invalid)


def test_save_confirm_revision_and_restore_do_not_mutate_storyboard_frames():
    pipeline, script = make_pipeline()
    original_frames = [frame.model_dump() for frame in script.frames]
    plan = make_plan(pipeline)

    saved = pipeline.save_director_shooting_plan_draft("film", 1, 0, plan)
    assert saved.director_shooting_plan_draft_revision == 1
    confirmed = pipeline.apply_director_shooting_plan("film", plan, 0, 1)
    assert confirmed.director_shooting_plan_revisions[-1].revision == 1
    assert confirmed.frames[0].model_dump() == original_frames[0]

    edited = plan.model_dump()
    edited["scenes"][0]["beats"][0]["shots"][0]["visual_intent"] = "画面改为从入口右侧观察两人。"
    pipeline.save_director_shooting_plan_draft("film", 1, 1, edited)
    restored = pipeline.restore_director_shooting_plan_revision("film", 1, 2)
    assert restored.director_shooting_plan_draft_revision == 3
    assert restored.director_shooting_plan_draft.scenes[0].beats[0].shots[0].visual_intent == plan.scenes[0].beats[0].shots[0].visual_intent
    assert restored.frames[0].model_dump() == original_frames[0]


def test_confirmation_rejects_missing_performance_physics_or_lighting():
    pipeline, _ = make_pipeline()
    plan = make_plan(pipeline).model_dump()
    shot = plan["scenes"][0]["beats"][0]["shots"][0]
    shot["action_physics"] = ""
    shot["lighting"]["key_source"] = ""

    pipeline.save_director_shooting_plan_draft("film", 1, 0, plan)
    with pytest.raises(ValueError, match="physical action"):
        pipeline.apply_director_shooting_plan("film", plan, 0, 1)


def test_long_plan_batch_cache_shape_resumes_completed_chunks(monkeypatch):
    pipeline, _ = make_pipeline()
    chunk_refs = ["source:chars-0-25", "source:chars-25-50"]
    chunks = [
        {"source_ref": chunk_refs[0], "char_start": 0, "char_end": 25, "text": "scene start"},
        {"source_ref": chunk_refs[1], "char_start": 25, "char_end": 50, "text": "scene continuation"},
    ]
    monkeypatch.setattr("src.apps.comic_gen.llm.split_director_source", lambda *args, **kwargs: chunks)
    first_result = valid_chunk()
    continued_scene = raw_scene(continues_previous_scene=True)
    second_result = valid_chunk(continued_scene)
    pipeline.script_processor.plan_director_shooting_chunk.side_effect = [first_result, RuntimeError("temporary provider error")]
    saved_batches = []

    with pytest.raises(RuntimeError, match="temporary provider error"):
        pipeline.preview_director_shooting_plan(
            "film",
            save_batch=lambda index, source_ref, result: saved_batches.append((index, source_ref, result)) or True,
        )
    assert saved_batches[0][2]["result"] == first_result

    pipeline.script_processor.plan_director_shooting_chunk.side_effect = [second_result]
    plan = pipeline.preview_director_shooting_plan(
        "film",
        load_batches=lambda: {
            0: {"source_ref": chunk_refs[0], "frames": saved_batches[0][2]},
        },
    )

    assert pipeline.script_processor.plan_director_shooting_chunk.call_count == 3
    assert len(plan.scenes) == 1
    assert plan.scenes[0].source_chunk_refs == chunk_refs
    assert len(plan.scenes[0].beats) == 2


def test_job_batch_reload_preserves_result_wrapper_consistently(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from src.apps.comic_gen.extraction_jobs import ExtractionJobs

    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / "director-plan-jobs.db", executor=executor)

        def work(job_id):
            assert jobs.save_batch("owner", "film", "director_shooting_plan:test", job_id, 0,
                                   "source:chars-0-25", {"result": valid_chunk()})
            return {"plan": "done"}

        job = jobs.start("owner", "film", "director_shooting_plan:test", work,
                         pass_job_id=True, total_batches=1)
        deadline = __import__("time").monotonic() + 3
        while __import__("time").monotonic() < deadline:
            result = jobs.get("owner", "film", job["id"])
            if result["status"] != "running":
                break
            __import__("time").sleep(0.01)
        else:
            pytest.fail("director shooting-plan job did not finish")
        loaded = jobs.load_batches("owner", "film", "director_shooting_plan:test")

    assert result["status"] == "completed"
    assert loaded[0]["source_ref"] == "source:chars-0-25"
    assert loaded[0]["frames"]["result"]["scenes"][0]["scene_ref"] == "场景 6 电影院 日 内"


def test_plan_api_keeps_large_resource_separate_and_confirms_without_touching_frames(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from types import SimpleNamespace
    import time
    from fastapi.testclient import TestClient
    from src.apps.comic_gen import api
    from src.apps.comic_gen.extraction_jobs import ExtractionJobs
    from src.apps.identity import UserContext
    from src.apps.studio_access import require_studio_user

    pipeline, script = make_pipeline()
    script.owner_profile_id = "owner"
    plan = make_plan(pipeline)
    user = UserContext("user", "owner", "Test", "")
    frames_before = [frame.model_dump() for frame in script.frames]
    executor = ThreadPoolExecutor(max_workers=1)
    jobs = ExtractionJobs(tmp_path / "plan-api-jobs.db", executor=executor)
    monkeypatch.setattr(api, "pipeline", pipeline)
    monkeypatch.setattr(api, "extraction_jobs", jobs)
    monkeypatch.setattr(api, "_resolve_request_context", lambda *args: (user, False))
    api.app.dependency_overrides[require_studio_user] = lambda: user

    try:
        with TestClient(api.app) as client:
            state = client.get("/projects/film/director-shooting-plan")
            assert state.status_code == 200
            assert state.json()["draft"] is None
            assert state.json()["source_chunks"][0]["source_ref"] == plan.scenes[0].source_chunk_refs[0]

            draft = client.put(
                "/projects/film/director-shooting-plan/draft",
                json={"source_revision": 1, "expected_draft_revision": 0, "plan": plan.model_dump()},
            )
            assert draft.status_code == 200
            assert draft.json()["draft_revision"] == 1

            confirmed = client.post(
                "/projects/film/director-shooting-plan/confirm",
                json={
                    "expected_current_revision": 0,
                    "expected_draft_revision": 1,
                    "plan": plan.model_dump(),
                },
            )
            assert confirmed.status_code == 200
            assert confirmed.json()["current_revision"] == 1
            revision = client.get("/projects/film/director-shooting-plan/revisions/1")
            assert revision.status_code == 200
            assert revision.json()["shot_count"] == 1

            pipeline.script_processor.llm = SimpleNamespace(
                provider="test", _get_default_model=lambda: "test-model",
            )
            def preview_plan(project_id, **kwargs):
                assert project_id == "film"
                assert kwargs["load_batches"]() == {}
                assert kwargs["save_batch"](
                    0,
                    plan.scenes[0].source_chunk_refs[0],
                    {"result": valid_chunk()},
                )
                return plan
            pipeline.preview_director_shooting_plan = Mock(side_effect=preview_plan)
            job = client.post("/projects/film/director-shooting-plan-jobs", json={})
            assert job.status_code == 202
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                status = client.get(f"/projects/film/director-shooting-plan-jobs/{job.json()['id']}")
                if status.json()["status"] != "running":
                    break
                time.sleep(0.01)
            else:
                pytest.fail("director shooting-plan API job did not finish")
            assert status.json()["result"]["plan"]["scenes"][0]["scene_ref"] == "场景 6 电影院 日 内"
            assert status.json()["progress"] == {"completed": 1, "total": 1}

        ordinary_script = api._script_response_dump(script)
        assert "director_shooting_plan_draft" not in ordinary_script
        assert "director_shooting_plan_revisions" not in ordinary_script
        assert [frame.model_dump() for frame in script.frames] == frames_before
    finally:
        api.app.dependency_overrides.pop(require_studio_user, None)
        executor.shutdown(wait=True)
