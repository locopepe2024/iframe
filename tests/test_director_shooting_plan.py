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
    DirectorPlanCastBinding,
    DirectorPlanLighting,
    DirectorPlanPropBinding,
    DirectorPlanSceneBinding,
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
        "director_effect": "先建立轻松亲密，再让明亮入口带出短暂的不安。",
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


def test_saved_plan_scene_asset_id_survives_project_reload(tmp_path):
    pipeline, script = make_pipeline()
    plan = make_plan(pipeline)
    plan.scenes[0].scene_asset_id = "cinema"
    script.director_shooting_plan_revisions = []
    script.director_shooting_plan_draft = plan
    path = tmp_path / "projects.json"
    path.write_text(json.dumps({"film": script.model_dump()}, ensure_ascii=False))
    pipeline.data_file = str(path)

    loaded = pipeline._load_data()

    assert loaded["film"].director_shooting_plan_draft.scenes[0].scene_asset_id == "cinema"


def test_invalid_project_does_not_hide_other_projects(tmp_path):
    pipeline, script = make_pipeline()
    path = tmp_path / "projects.json"
    path.write_text(json.dumps({"film": script.model_dump(), "invalid": {"unexpected": True}}, ensure_ascii=False))
    pipeline.data_file = str(path)

    loaded = pipeline._load_data()

    assert list(loaded) == ["film"]
    pipeline.scripts = loaded
    pipeline._save_data()
    assert json.loads(path.read_text())["invalid"] == {"unexpected": True}


def test_malformed_project_store_cannot_be_overwritten(tmp_path):
    pipeline, _ = make_pipeline()
    path = tmp_path / "projects.json"
    path.write_text("{broken")
    pipeline.data_file = str(path)

    assert pipeline._load_data() == {}
    pipeline._save_data()
    assert path.read_text() == "{broken"


def test_llm_accepts_missing_visual_atoms_for_downstream_editing():
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

    assert result["scenes"][0]["beats"][0]["shots"][0]["action_physics"] == ""
    assert processor.llm.chat.call_count == 1


def test_shooting_plan_prompt_turns_confirmed_region_into_optional_visual_anchor():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps(valid_chunk(), ensure_ascii=False)

    processor.plan_director_shooting_chunk(
        "大学宿舍里，两人讨论毕业去向。",
        {"characters": [], "props": []},
        {
            "execution_summary": "SETTING: 学校所在地为西安。",
            "setting": {"locations": "西安"},
        },
        {"style": "生活化电影"},
        source_ref="source:chars-0-20",
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "可选导演视觉锚点" in prompt
    assert "不得伪装成已发生的剧本事实" in prompt
    assert "unresolved_questions" in prompt
    assert '<stage_preset name="shooting-plan-handoff">' in prompt
    assert "视觉风格摘要约束镜头的可见表达" in prompt


def test_plan_lineage_ignores_style_changes_but_rejects_director_changes_and_unknown_references():
    pipeline, script = make_pipeline()
    plan = make_plan(pipeline)

    original_style_hash = plan.effective_style_hash
    script.art_direction.style_config["visual_language"] = "日系写实"
    current_lineage = pipeline.director_shooting_plan_lineage("film")
    assert current_lineage["effective_style_hash"] != original_style_hash
    accepted_after_style_change = pipeline._validate_director_shooting_plan(script, plan)
    assert accepted_after_style_change.effective_style_hash == original_style_hash

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
    accepted = pipeline._validate_director_shooting_plan(script, invalid)
    assert accepted.scenes[0].beats[0].shots[0].prop_ids == ["unknown-prop"]


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
    assert restored.director_shooting_plan_draft.scenes[0].beats[0].shots[0].director_effect == plan.scenes[0].beats[0].shots[0].director_effect
    assert restored.frames[0].model_dump() == original_frames[0]


def test_confirmed_plan_projects_scene_shot_character_and_prop_context():
    pipeline, script = make_pipeline()
    plan = make_plan(pipeline)
    plan.scenes[0].beats[0].shots[0].cast_bindings = [DirectorPlanCastBinding(**{
        "person_id": "shen-xia-young",
        "era_variant_id": "era-campus",
        "scene_look_id": "look-winter-outdoor",
        "continuity_state": {"coat": "white down jacket"},
        "binding_status": "confirmed",
    })]
    plan.scenes[0].beats[0].shots[0].scene_binding = DirectorPlanSceneBinding(**{
        "scene_asset_id": "cinema",
        "interior_exterior": "exterior",
        "time_of_day": "day",
        "season": "winter",
        "weather": "overcast",
        "binding_status": "confirmed",
    })
    plan.scenes[0].beats[0].shots[0].prop_bindings = [DirectorPlanPropBinding(**{
        "prop_id": "ticket", "state": "held", "binding_status": "confirmed",
    })]
    pipeline.save_director_shooting_plan_draft("film", 1, 0, plan)
    pipeline.apply_director_shooting_plan("film", plan, 0, 1)

    context = pipeline.project_episode_visual_context("film")
    assert context.scenes[0].season == "winter"
    assert context.characters[0].scene_look_id == "look-winter-outdoor"
    assert context.characters[0].shot_ids == [plan.scenes[0].beats[0].shots[0].shot_id]
    assert context.props[0].state == "held"
    result = pipeline.sync_episode_assets_from_shooting_plan("film")
    assert len(result["new_bindings"]) == 3
    assert script.episode_visual_context is not None


def test_asset_sync_marks_changed_and_stale_bindings_without_overwriting_selection():
    pipeline, _ = make_pipeline()
    plan = make_plan(pipeline)
    pipeline.save_director_shooting_plan_draft("film", 1, 0, plan)
    pipeline.apply_director_shooting_plan("film", plan, 0, 1)
    first = pipeline.sync_episode_assets_from_shooting_plan("film")
    pipeline.scripts["film"].episode_asset_bindings[0].selected_variant_id = "variant-kept"
    plan.scenes[0].time_anchor = "夜间"
    pipeline.save_director_shooting_plan_draft("film", 1, 1, plan)
    pipeline.apply_director_shooting_plan("film", plan, 1, 2)
    second = pipeline.sync_episode_assets_from_shooting_plan("film")
    assert second["changed_bindings"]
    assert any(item["selected_variant_id"] == "variant-kept" for item in second["changed_bindings"])
    assert not second["stale_bindings"]


def test_asset_sync_maps_person_to_character_and_preserves_distinct_scene_looks():
    pipeline, script = make_pipeline()
    plan = make_plan(pipeline)
    first = plan.scenes[0].beats[0].shots[0]
    first.cast_bindings = [DirectorPlanCastBinding(
        person_id="shen-xia", scene_look_id="outdoor-coat",
        continuity_state={"coat": "white down jacket"}, binding_status="confirmed")]
    second_scene = plan.scenes[0].model_copy(deep=True)
    second_scene.scene_id = "cinema-interior"
    second_scene.order = 1
    second_scene.scene_ref = "电影院内景"
    second_scene.beats[0].beat_id = "beat-interior"
    second_scene.beats[0].shots[0].shot_id = "shot-interior"
    second_scene.beats[0].shots[0].cast_bindings = [DirectorPlanCastBinding(
        person_id="shen-xia", scene_look_id="indoor-knitwear",
        continuity_state={"coat": "removed"}, binding_status="confirmed")]
    plan.scenes.append(second_scene)
    pipeline.save_director_shooting_plan_draft("film", 1, 0, plan)
    pipeline.apply_director_shooting_plan("film", plan, 0, 1)

    context = pipeline.project_episode_visual_context("film")
    assert {item.scene_look_id for item in context.characters} == {"outdoor-coat", "indoor-knitwear"}
    assert all(item.character_asset_ids == ["shen-xia-young"] for item in context.characters)
    result = pipeline.sync_episode_assets_from_shooting_plan("film")
    character_bindings = [item for item in result["bindings"] if item["asset_type"] == "character"]
    assert len(character_bindings) == 1
    assert character_bindings[0]["asset_id"] == "shen-xia-young"
    assert character_bindings[0]["scene_ids"] == ["scene-cinema", "cinema-interior"]
    assert pipeline._episode_asset_context_prompt(script, "character", "shen-xia-young") == ""


def test_multi_era_person_requires_explicit_variant_before_asset_binding():
    pipeline, script = make_pipeline()
    career = Character(id="shen-xia-career", name="沈夏（职场）", description="职场时期", base_character_id="shen-xia")
    script.characters.append(career)
    script.art_direction.director_profile.story_map.people[0].variant_character_ids.append(career.id)
    pipeline.resolve_episode_assets.return_value["characters"].append(career)
    plan = make_plan(pipeline)
    plan.scenes[0].beats[0].shots[0].character_ids = []
    plan.scenes[0].beats[0].shots[0].cast_bindings = [DirectorPlanCastBinding(person_id="shen-xia")]
    pipeline.save_director_shooting_plan_draft("film", 1, 0, plan)
    pipeline.apply_director_shooting_plan("film", plan, 0, 1)

    result = pipeline.sync_episode_assets_from_shooting_plan("film")
    assert any(item.get("reason") == "era_variant_unresolved" for item in result["unresolved_bindings"])
    assert not any(item["asset_type"] == "character" for item in result["bindings"])


def test_sync_only_marks_assets_affected_by_a_plan_change():
    pipeline, _ = make_pipeline()
    plan = make_plan(pipeline)
    second_scene = plan.scenes[0].model_copy(deep=True)
    second_scene.scene_id = "scene-restaurant"
    second_scene.order = 1
    second_scene.beats[0].beat_id = "beat-restaurant"
    second_scene.beats[0].shots[0].shot_id = "shot-restaurant"
    plan.scenes.append(second_scene)
    pipeline.save_director_shooting_plan_draft("film", 1, 0, plan)
    pipeline.apply_director_shooting_plan("film", plan, 0, 1)
    pipeline.sync_episode_assets_from_shooting_plan("film")

    plan.scenes[1].time_anchor = "冬季夜间"
    pipeline.save_director_shooting_plan_draft("film", 1, 1, plan)
    pipeline.apply_director_shooting_plan("film", plan, 1, 2)
    result = pipeline.sync_episode_assets_from_shooting_plan("film")
    assert any(item["asset_id"] == "scene-cinema" for item in result["reusable_bindings"])
    assert any(item["asset_id"] == "scene-restaurant" for item in result["changed_bindings"])

def test_style_save_preserves_episode_assets_and_director_profile():
    pipeline, script = make_pipeline()
    asset_ids_before = (
        [item.id for item in script.characters],
        [item.id for item in script.scenes],
        [item.id for item in script.props],
    )
    profile_before = script.art_direction.director_profile

    updated = pipeline.save_art_direction(
        "film",
        "japanese-live-action",
        {"name": "日系写实", "positive_prompt": "自然光、克制色彩"},
    )

    assert (
        [item.id for item in updated.characters],
        [item.id for item in updated.scenes],
        [item.id for item in updated.props],
    ) == asset_ids_before
    assert updated.art_direction.director_profile == profile_before


def test_adopting_new_director_interpretation_creates_new_plan_revision():
    pipeline, script = make_pipeline()
    old_plan = make_plan(pipeline)
    pipeline.save_director_shooting_plan_draft("film", 1, 0, old_plan)
    pipeline.apply_director_shooting_plan("film", old_plan, 0, 1)

    script.art_direction.director_profile.revision = 4
    script.art_direction.director_profile.content_hash = "director-hash-v4"
    lineage = pipeline.director_shooting_plan_lineage("film")
    aligned_plan = old_plan.model_copy(update={
        "director_profile_revision": lineage["director_profile_revision"],
        "director_profile_hash": lineage["director_profile_hash"],
        "effective_style_hash": lineage["effective_style_hash"],
    })
    pipeline.save_director_shooting_plan_draft("film", 1, 1, aligned_plan)
    pipeline.apply_director_shooting_plan("film", aligned_plan, 1, 2)

    assert [item.revision for item in script.director_shooting_plan_revisions] == [1, 2]
    assert script.director_shooting_plan_revisions[0].plan.director_profile_revision == 3
    assert script.director_shooting_plan_revisions[1].plan.director_profile_revision == 4


def test_confirmation_allows_missing_performance_physics_or_lighting_for_later_editing():
    pipeline, _ = make_pipeline()
    plan = make_plan(pipeline).model_dump()
    shot = plan["scenes"][0]["beats"][0]["shots"][0]
    shot["action_physics"] = ""
    shot["lighting"]["key_source"] = ""

    pipeline.save_director_shooting_plan_draft("film", 1, 0, plan)
    confirmed = pipeline.apply_director_shooting_plan("film", plan, 0, 1)
    assert confirmed.director_shooting_plan_revisions[-1].revision == 1


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
