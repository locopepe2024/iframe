"""Staged generation must not repeat paid work or admit partial/broken drafts."""
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.director_profile_stages import STAGES
from src.apps.comic_gen.extraction_jobs import ExtractionJobs
from src.apps.comic_gen.llm import ScriptProcessor, _director_profile_output_contract
from src.apps.comic_gen.models import DirectorProfile, Series
from tests.test_director_profile import make_pipeline, profile_payload, valid_story_map
from tests.test_extraction_jobs import wait_done


def responses():
    result = {**DirectorProfile().model_dump(), **profile_payload(), "story_map": valid_story_map(),
              "scene_summaries": [{"scene_ref": "场景21", "summary": "沈夏与周涵相恋", "state_in": "", "state_out": ""}],
              "canon_state": {}, "execution_summary": "中国校园，两人相恋；保持地理连续。"}
    for key in ("source_revision", "source_revision_id", "fact_ledger_revision", "people"):
        result["story_map"].pop(key, None)
    return [{field: result[field] for field in fields} for _, _, fields in STAGES[1:]]


def setup_pipeline():
    pipeline, script = make_pipeline()
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True, provider="greena")
    processor.llm._get_default_model.return_value = "llm-nf-all"
    processor.llm.chat.side_effect = [json.dumps(step, ensure_ascii=False) for step in responses()]
    pipeline.script_processor = processor
    return pipeline, script, processor


def generate(pipeline, cached=None, save_step=None):
    return pipeline.preview_director_profile_with_audit("film", stage_cache=cached or {}, save_step=save_step)


def checkpoint_store(cache, writes=None):
    def save(index, key, value):
        cache[index] = {"source_ref": key, "frames": copy.deepcopy(value)}
        if writes is not None:
            writes.append(key)
        return True
    return save


def test_scoped_contracts_have_only_reachable_definitions():
    for _, _, fields in STAGES[1:]:
        contract = _director_profile_output_contract(fields=fields)
        schema = json.loads(contract.split("<director_output_contract>")[1].split("</director_output_contract>")[0])
        assert set(schema["properties"]) == set(schema["required"]) == set(fields)
        assert schema["additionalProperties"] is False
        assert ("$defs" in schema) == ("story_map" in fields)
        if "story_map" in fields:
            assert "people" not in schema["$defs"]["DirectorStoryMap"]["properties"]


def test_three_bounded_streamed_requests_complete_without_mutating_user_drafts():
    pipeline, script, processor = setup_pipeline()
    original = script.model_dump()
    cache = {}
    result = generate(pipeline, save_step=checkpoint_store(cache))
    assert list(cache) == [0, 1, 2, 3]
    assert result["profile"]["story_map"]["source_revision"] == script.source_revision
    assert result["profile"]["execution_summary"].startswith(responses()[2]["execution_summary"])
    assert script.model_dump() == original
    assert processor.llm.chat.call_count == 3
    for call, (_, label, fields) in zip(processor.llm.chat.call_args_list, STAGES[1:]):
        kwargs = call.kwargs
        assert kwargs["stream"] is True and kwargs["timeout_seconds"] == 1800
        assert "max_tokens" not in kwargs
        prompt = kwargs["messages"][0]["content"]
        assert "当前独立步骤：" + label in prompt
        assert prompt.count(script.original_text) == 1
        schema = json.loads(prompt.split("<director_output_contract>")[1].split("</director_output_contract>")[0])
        assert set(schema["properties"]) == set(fields)
        assert "生成完整导演设定草稿" not in prompt
    assert result["source_audit"]["admission_status"] == "confirmable"


def test_provider_error_retries_only_unfinished_step_with_saved_source_context():
    pipeline, _, processor = setup_pipeline()
    cache, writes = {}, []
    failure = RuntimeError("upstream error event")
    failure.llm_diagnostic = {"stream": True, "text_chars": 10000}
    processor.llm.chat.side_effect = [json.dumps(responses()[0]), failure]
    with pytest.raises(RuntimeError) as error:
        generate(pipeline, save_step=checkpoint_store(cache, writes))
    assert error.value.director_profile_failure == "story"
    assert writes == ["source", "foundation"]
    processor.director_source_audit = Mock(side_effect=AssertionError("must reuse source"))
    processor._director_source_context = Mock(side_effect=AssertionError("must reuse source"))
    processor.llm.chat.reset_mock(side_effect=True)
    processor.llm.chat.side_effect = [json.dumps(step) for step in responses()[1:]]
    result = generate(pipeline, cached=cache, save_step=checkpoint_store(cache, writes))
    assert processor.llm.chat.call_count == 2
    assert writes == ["source", "foundation", "story", "continuity"]
    assert result["source_audit"]["steps"][0]["reused"] is True


@pytest.mark.parametrize("bad", ["{", "{}", '{"story_map":null}',
    json.dumps({**responses()[1], "story_map": {"phases": [], "relationship_arcs": [{"relationship_id": "bad", "states": [{"phase_id": "missing", "state": "unknown"}]}], "story_threads": []}})])
def test_invalid_structure_never_becomes_checkpoint(bad):
    pipeline, _, processor = setup_pipeline()
    processor.llm.chat.side_effect = [json.dumps(responses()[0]), bad]
    cache = {}
    with pytest.raises((ValueError, TypeError)):
        generate(pipeline, save_step=checkpoint_store(cache))
    assert list(cache) == [0, 1]
    assert processor.llm.chat.call_count == 2


def test_rejected_checkpoint_stops_next_paid_call():
    pipeline, _, processor = setup_pipeline()
    with pytest.raises(RuntimeError, match="任务已失效"):
        generate(pipeline, save_step=lambda index, *args: index == 0)
    assert processor.llm.chat.call_count == 1


@pytest.mark.parametrize("changed", ["source", "style", "model", "entities"])
def test_changed_inputs_do_not_reuse_any_completed_step(changed):
    pipeline, script, processor = setup_pipeline()
    cache = {}
    generate(pipeline, save_step=checkpoint_store(cache))
    if changed == "source":
        script.original_text += " 新场景"
    elif changed == "style":
        script.art_direction.style_config = {"name": "新风格"}
    elif changed == "model":
        processor.llm._get_default_model.return_value = "deepseek-v4.1-flash"
    else:
        script.characters[0].name = "新名字"
    processor.llm.chat.reset_mock(side_effect=True)
    processor.llm.chat.side_effect = [json.dumps(step) for step in responses()]
    writes = []
    generate(pipeline, cached=cache, save_step=checkpoint_store(cache, writes))
    assert processor.llm.chat.call_count == 3
    assert writes == ["source", "foundation", "story", "continuity"]


def test_durable_progress_resume_and_owner_context(tmp_path):
    pipeline, _, processor = setup_pipeline()
    account = ContextVar("account", default="other")
    account.set("kent")
    owners = []
    first_responses = iter([json.dumps(responses()[0]), RuntimeError("stream error")])
    def chat(**kwargs):
        owners.append(account.get())
        value = next(first_responses)
        if isinstance(value, Exception):
            value.llm_diagnostic = {"stream": True, "text_chars": 10}
            raise value
        return value
    processor.llm.chat.side_effect = chat
    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / "jobs.db", executor=executor)
        def work(job_id):
            return generate(pipeline, cached=store.load_batches("owner", "project", "director:test"),
                save_step=lambda i, key, value: store.save_batch("owner", "project", "director:test", job_id, i, key, value))
        first = store.start("owner", "project", "director:test", work, pass_job_id=True, total_batches=4)
        failed = wait_done(store, first)
        assert failed["progress"] == {"completed": 2, "total": 4, "stage": "story"}
        assert "故事结构" in failed["error"] and "已保存 2/4" in failed["error"]
        assert failed["result"]["failure_stage"] == "story"
        assert store.load_batches("other", "project", "director:test") == {}
        store = ExtractionJobs(tmp_path / "jobs.db", executor=executor)
        processor.llm.chat.side_effect = [json.dumps(step) for step in responses()[1:]]
        retry = store.start("owner", "project", "director:test", work, pass_job_id=True, total_batches=4)
        done = wait_done(store, retry)
        assert done["status"] == "completed"
        assert done["progress"] == {"completed": 4, "total": 4, "stage": None}
        assert owners == ["kent", "kent"]
        assert done["result"]["profile"]["story_map"]


def test_superseded_worker_cannot_save_another_step(tmp_path):
    from concurrent.futures import Future
    executor = Mock()
    executor.submit.return_value = Future()
    store = ExtractionJobs(tmp_path / "jobs.db", executor=executor)
    job = store.start("owner", "project", "director:test", lambda: {}, total_batches=4)
    with store.connect() as db:
        db.execute("UPDATE jobs SET superseded=1 WHERE id=?", (job["id"],))
    assert store.save_batch("owner", "project", "director:test", job["id"], 0, "source", {}) is False


def test_series_stages_preserve_global_scope_and_do_not_confirm():
    pipeline, script, processor = setup_pipeline()
    series = Series(id="series", title="全剧", created_at=1, updated_at=1,
                    episode_ids=[script.id], source_context={"preamble": "两人跨集关系"})
    pipeline.series_store[series.id] = series
    cache = {}
    result = pipeline.preview_series_director_profile(series.id, stage_cache={}, save_step=checkpoint_store(cache))
    assert len(cache) == 4
    assert result["profile"]["story_map"] is None
    assert result["scope"] == "series"
    assert series.director_profile_draft is None and series.director_profile_revisions == []
    assert all("Series 全剧导演理解" in call.kwargs["messages"][0]["content"] for call in processor.llm.chat.call_args_list)


def test_completed_checkpoint_revalidates_without_paid_calls_or_summary_drift():
    pipeline, _, processor = setup_pipeline()
    cache = {}
    first = generate(pipeline, save_step=checkpoint_store(cache))
    processor.llm.chat.reset_mock(side_effect=True)
    processor.llm.chat.side_effect = AssertionError("must not generate again")
    second = generate(pipeline, cached=cache)
    processor.llm.chat.assert_not_called()
    assert second["profile"] == first["profile"]


@pytest.mark.parametrize("kind", ["oversized", "missing_scenes"])
def test_unbounded_output_or_missing_scene_memory_is_not_saved(kind):
    pipeline, _, processor = setup_pipeline()
    data = responses()
    if kind == "oversized":
        data[2]["execution_summary"] = "x" * 25000
    else:
        data[2]["scene_summaries"] = []
    processor.llm.chat.side_effect = [json.dumps(step) for step in data]
    cache = {}
    with pytest.raises(ValueError):
        generate(pipeline, save_step=checkpoint_store(cache))
    assert list(cache) == [0, 1, 2]


def test_endpoint_retries_saved_steps_and_invalidates_cache_for_new_model(tmp_path, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    import time
    pipeline, script, processor = setup_pipeline()
    monkeypatch.setattr(api, "pipeline", pipeline)
    user = UserContext("kent", "kent-owner", "", "")
    failure = RuntimeError("upstream error")
    failure.llm_diagnostic = {"stream": True, "text_chars": 30}
    processor.llm.chat.side_effect = [json.dumps(responses()[0]), failure]
    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / "api-jobs.db", executor=executor)
        monkeypatch.setattr(api, "extraction_jobs", store)
        def submit():
            return api.start_director_profile_analysis(script.id, api.director_skills.DirectorSkillsRequest(), user)
        def done(job):
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                value = store.get(user.owner_profile_id, script.id, job["id"])
                if value["status"] != "running":
                    return value
                time.sleep(.01)
            pytest.fail("worker did not finish")
        first = done(submit())
        assert first["status"] == "failed" and first["progress"]["completed"] == 2
        processor.llm.chat.reset_mock(side_effect=True)
        processor.llm.chat.side_effect = [json.dumps(step) for step in responses()[1:]]
        retry = done(submit())
        assert retry["status"] == "completed" and processor.llm.chat.call_count == 2
        assert submit()["id"] == retry["id"]
        processor.llm._get_default_model.return_value = "deepseek-v4.1-flash"
        processor.llm.chat.reset_mock(side_effect=True)
        processor.llm.chat.side_effect = [json.dumps(step) for step in responses()]
        changed = done(submit())
        assert changed["id"] != retry["id"] and changed["status"] == "completed"
        assert processor.llm.chat.call_count == 3
        assert script.director_profile_draft is None


def test_endpoint_rejects_source_change_before_persisting_more_steps(tmp_path, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    import time
    pipeline, script, processor = setup_pipeline()
    monkeypatch.setattr(api, "pipeline", pipeline)
    user = UserContext("kent", "kent-owner", "", "")
    def chat(**kwargs):
        script.original_text += " changed while generating"
        return json.dumps(responses()[0])
    processor.llm.chat.side_effect = chat
    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / "api-jobs.db", executor=executor)
        monkeypatch.setattr(api, "extraction_jobs", store)
        job = api.start_director_profile_analysis(script.id, api.director_skills.DirectorSkillsRequest(), user)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = store.get(user.owner_profile_id, script.id, job["id"])
            if result["status"] != "running":
                break
            time.sleep(.01)
        assert result["status"] == "failed" and result["progress"]["completed"] == 1
        assert processor.llm.chat.call_count == 1
        assert script.director_profile_draft is None


def test_series_endpoint_cache_changes_with_style_and_model(tmp_path, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import ArtDirection
    from src.apps.identity import UserContext
    pipeline, script, processor = setup_pipeline()
    series = Series(id="series", title="全剧", created_at=1, updated_at=1,
                    episode_ids=[script.id], source_context={"preamble": "全剧资料"})
    pipeline.series_store[series.id] = series
    monkeypatch.setattr(api, "pipeline", pipeline)
    captured = []
    monkeypatch.setattr(api.extraction_jobs, "start", lambda *args, **kwargs: captured.append((args, kwargs)) or {})
    user = UserContext("kent", "kent-owner", "", "")
    def submit():
        api.start_series_director_profile_analysis(series.id, api.director_skills.DirectorSkillsRequest(), user)
    submit()
    series.art_direction = ArtDirection(selected_style_id="new", style_config={"name": "new style"})
    submit()
    processor.llm._get_default_model.return_value = "deepseek-v4.1-flash"
    submit()
    assert len({args[2] for args, _ in captured}) == 3
    assert all(kwargs["pass_job_id"] and kwargs["total_batches"] == 4 for _, kwargs in captured)
