"""Staged generation must not repeat paid work or admit partial/broken drafts."""
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.director_profile_stages import STAGES, METHOD_STEPS, build_step_prompt
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
        assert ("sample_plan 必须是对象数组" in contract) == ("sample_plan" in fields)
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


@pytest.mark.parametrize("sample", [
    {"Opening": "开场", "Core_Action": "主要动作", "Transition": "转场", "Climax": "高潮"},
    {"Scene_1_Flow": "第一场", "Scene_2_Flow": "第二场", "Scene_3_Flow": "第三场", "Scene_4_Flow": "第四场"},
])
def test_named_sample_plan_object_is_preserved_and_checkpointed_without_another_call(sample):
    pipeline, script, processor = setup_pipeline()
    original = script.model_dump()
    steps = responses()
    steps[0]["sample_plan"] = sample
    processor.llm.chat.side_effect = [json.dumps(step, ensure_ascii=False) for step in steps]
    cache = {}
    result = generate(pipeline, save_step=checkpoint_store(cache))
    assert result["profile"]["sample_plan"] == [sample]
    assert cache[1]["frames"]["profile"]["sample_plan"] == [sample]
    assert json.loads(cache[1]["frames"]["raw_response"])["sample_plan"] == sample
    assert processor.llm.chat.call_count == 3
    assert script.model_dump() == original
    processor.llm.chat.reset_mock(side_effect=True)
    processor.llm.chat.side_effect = AssertionError("must reuse admitted steps")
    assert generate(pipeline, cached=cache)["profile"] == result["profile"]
    processor.llm.chat.assert_not_called()


def test_staged_prompts_exclude_other_steps_and_empty_context():
    pipeline, script, processor = setup_pipeline()
    generate(pipeline)
    prompts = [call.kwargs["messages"][0]["content"] for call in processor.llm.chat.call_args_list]
    for prompt in prompts:
        assert prompt.count(script.original_text) == 1
        for unused in ("<stage_preset", "crowd_groups", "群体模板", "chunk_summaries",
                       "<visual_style_summary>", "series_context", "<visual_style>{}</visual_style>"):
            assert unused not in prompt
    foundation, story, continuity = prompts
    assert "story_map" not in foundation and "scene_summaries" not in foundation
    assert "completed_steps_readonly" not in foundation
    assert "scene_summaries" not in story
    assert "scene_summaries" in continuity


def test_selected_methods_and_style_only_reach_relevant_steps():
    from src.apps.director_skills import catalog
    pipeline, script, processor = setup_pipeline()
    script.art_direction.style_config = {"user_constraint": "STYLE_SENTINEL"}
    methods = [item for item in catalog("episode") if item["id"] in ("people-relations", "continuity-review")]
    pipeline.preview_director_profile_with_audit("film", stage_cache={}, skill_snapshot=methods)
    prompts = [call.kwargs["messages"][0]["content"] for call in processor.llm.chat.call_args_list]
    assert "STYLE_SENTINEL" in prompts[0] and "STYLE_SENTINEL" in prompts[2]
    assert "STYLE_SENTINEL" not in prompts[1]
    assert methods[0]["instructions"] in prompts[1]
    assert methods[0]["instructions"] not in prompts[0] + prompts[2]
    assert methods[1]["instructions"] in prompts[2]
    assert methods[1]["instructions"] not in prompts[0] + prompts[1]
    assert "unresolved_questions在本步记录到canon_state.uncertainties" in prompts[2]


def test_unknown_selected_method_fails_before_provider_call():
    pipeline, _, processor = setup_pipeline()
    with pytest.raises(ValueError, match="方法.*步骤"):
        pipeline.preview_director_profile_with_audit("film", stage_cache={},
            skill_snapshot=[{"id": "future-method", "instructions": "Do not silently ignore"}])
    processor.llm.chat.assert_not_called()


def test_all_available_profile_methods_have_explicit_step_assignments():
    from src.apps.director_skills import catalog
    assert {item["id"] for scope in ("episode", "series") for item in catalog(scope)} == set(METHOD_STEPS)


def test_digest_and_series_handoff_keep_evidence_boundaries_without_full_profile():
    series_profile = {**profile_payload(), "sample_plan": [{"private_long_plan": "DO_NOT_RESEND"}],
                      "execution_summary": "CONFIRMED_SERIES_SENTINEL"}
    entities = {"characters": [], "series_context": {"preamble": "SERIES_BACKGROUND"},
                "series_director_understanding": series_profile}
    for key, _, _ in STAGES[1:]:
        prompt = build_step_prompt(key, "SOURCE_DIGEST", True, entities, {}, {})
        assert prompt.count("SOURCE_DIGEST") == 1
        assert "chunk_summaries" in prompt and "分块边界不是叙事边界" in prompt
        assert "SERIES_BACKGROUND" in prompt and "CONFIRMED_SERIES_SENTINEL" in prompt
        assert "不代表本集已发生的事实" in prompt
        assert "DO_NOT_RESEND" not in prompt


def test_completed_handoff_does_not_include_derived_unfinished_continuity():
    foundation = responses()[0]
    prompt = build_step_prompt("story", "SOURCE", False, {}, {}, foundation)
    handoff = json.loads(prompt.split("<completed_steps_readonly>")[1].split("</completed_steps_readonly>")[0])
    assert set(handoff) == {"execution_summary"}
    prompt = build_step_prompt("continuity", "SOURCE", False, {}, {}, {**foundation, **responses()[1]})
    handoff = json.loads(prompt.split("<completed_steps_readonly>")[1].split("</completed_steps_readonly>")[0])
    assert set(handoff) == {"execution_summary", "story_map"}


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


def test_missing_story_fields_are_completed_once_without_rewriting_returned_fields():
    pipeline, script, processor = setup_pipeline()
    original = script.model_dump()
    foundation, story, continuity = responses()
    partial = {key: story[key] for key in ("timeline", "relationships")}
    missing = {key: story[key] for key in ("key_events", "story_map")}
    processor.llm.chat.side_effect = [json.dumps(step) for step in (foundation, partial, missing, continuity)]
    cache = {}
    result = generate(pipeline, save_step=checkpoint_store(cache))
    assert list(cache) == [0, 1, 2, 3] and processor.llm.chat.call_count == 4
    assert all(result["profile"][key] == value for key, value in partial.items())
    completion_call = processor.llm.chat.call_args_list[2].kwargs
    prompt = completion_call["messages"][0]["content"]
    schema = json.loads(prompt.split("<director_output_contract>")[1].split("</director_output_contract>")[0])
    assert set(schema["required"]) == set(schema["properties"]) == set(missing)
    assert prompt.count(script.original_text) == 1
    assert "<completed_fields_readonly>" in prompt
    assert "本次只输出以下顶层字段：key_events、story_map" in prompt
    assert completion_call["stream"] and "max_tokens" not in completion_call
    saved = cache[2]["frames"]
    assert json.loads(saved["raw_response"]) == partial
    assert json.loads(saved["field_completion"]["raw_response"]) == missing
    assert saved["field_completion"]["fields"] == ["key_events", "story_map"]
    assert script.model_dump() == original
    processor.llm.chat.reset_mock(side_effect=True)
    processor.llm.chat.side_effect = AssertionError("must reuse completed step")
    resumed = generate(pipeline, cached=cache)
    assert resumed["profile"] == result["profile"]
    processor.llm.chat.assert_not_called()


def test_missing_story_map_arrays_are_completed_without_regenerating_phases():
    pipeline, script, processor = setup_pipeline()
    foundation, story, continuity = responses()
    partial = copy.deepcopy(story)
    nested = {key: partial["story_map"].pop(key) for key in ("relationship_arcs", "story_threads")}
    processor.llm.chat.side_effect = [json.dumps(step) for step in
                                    (foundation, partial, {"story_map": nested}, continuity)]
    cache = {}
    result = generate(pipeline, save_step=checkpoint_store(cache))
    assert list(cache) == [0, 1, 2, 3] and processor.llm.chat.call_count == 4
    completed = result["profile"]["story_map"]
    assert completed["phases"][0]["phase_id"] == partial["story_map"]["phases"][0]["phase_id"]
    assert completed["phases"][0]["events"][0]["description"] == partial["story_map"]["phases"][0]["events"][0]["description"]
    assert completed["story_threads"][0]["milestones"] == story["story_map"]["story_threads"][0]["milestones"]
    prompt = processor.llm.chat.call_args_list[2].kwargs["messages"][0]["content"]
    schema = json.loads(prompt.split("<director_output_contract>")[1].split("</director_output_contract>")[0])
    sm = schema["$defs"]["DirectorStoryMap"]
    assert sm["required"] == list(nested) and set(sm["properties"]) == set(nested)
    assert schema["required"] == ["story_map"]
    assert "story_map.relationship_arcs" in prompt and "story_map.story_threads" in prompt
    assert prompt.count(script.original_text) == 1
    assert cache[2]["frames"]["field_completion"]["paths"] == [
        "story_map.relationship_arcs", "story_map.story_threads"]
    assert json.loads(cache[2]["frames"]["raw_response"]) == partial
    processor.llm.chat.reset_mock(side_effect=True)
    processor.llm.chat.side_effect = AssertionError("must reuse nested completion")
    assert generate(pipeline, cached=cache)["profile"] == result["profile"]
    processor.llm.chat.assert_not_called()


@pytest.mark.parametrize("replacement", [{"story_threads": []}, {"relationship_arcs": [], "story_threads": [], "phases": []}])
def test_nested_completion_rejects_missing_fields_and_attempted_phase_overwrite(replacement):
    pipeline, _, processor = setup_pipeline()
    partial = copy.deepcopy(responses()[1])
    for key in ("relationship_arcs", "story_threads"):
        partial["story_map"].pop(key)
    processor.llm.chat.side_effect = [json.dumps(step) for step in
                                    (responses()[0], partial, {"story_map": replacement})]
    cache = {}
    with pytest.raises(ValueError):
        generate(pipeline, save_step=checkpoint_store(cache))
    assert list(cache) == [0, 1] and processor.llm.chat.call_count == 3


def test_top_level_and_nested_missing_fields_share_one_completion_request():
    pipeline, _, processor = setup_pipeline()
    partial = copy.deepcopy(responses()[1])
    key_events = partial.pop("key_events")
    threads = partial["story_map"].pop("story_threads")
    completion = {"key_events": key_events, "story_map": {"story_threads": threads}}
    processor.llm.chat.side_effect = [json.dumps(step) for step in
                                    (responses()[0], partial, completion, responses()[2])]
    cache = {}
    generate(pipeline, save_step=checkpoint_store(cache))
    assert processor.llm.chat.call_count == 4 and len(cache) == 4
    assert cache[2]["frames"]["field_completion"]["paths"] == ["key_events", "story_map.story_threads"]


@pytest.mark.parametrize("completion", [{}, {"key_events": []}, {"key_events": [], "story_map": None},
    {**responses()[1], "PRIVATE_EXTRA_FIELD": "not echoed"}])
def test_invalid_missing_field_completion_stops_after_one_attempt(completion):
    pipeline, _, processor = setup_pipeline()
    partial = {key: responses()[1][key] for key in ("timeline", "relationships")}
    processor.llm.chat.side_effect = [json.dumps(step) for step in (responses()[0], partial, completion)]
    cache = {}
    with pytest.raises(ValueError) as caught:
        generate(pipeline, save_step=checkpoint_store(cache))
    assert processor.llm.chat.call_count == 3
    assert list(cache) == [0, 1]
    assert "PRIVATE_EXTRA_FIELD" not in str(caught.value)
    assert caught.value.director_audit["failure_stage"] == "story"


def test_completion_provider_error_keeps_prior_steps_and_does_not_auto_retry():
    pipeline, _, processor = setup_pipeline()
    failure = RuntimeError("upstream error event")
    failure.llm_diagnostic = {"stream": True, "text_chars": 27}
    partial = {key: responses()[1][key] for key in ("timeline", "relationships")}
    processor.llm.chat.side_effect = [json.dumps(responses()[0]), json.dumps(partial), failure]
    cache = {}
    with pytest.raises(RuntimeError) as caught:
        generate(pipeline, save_step=checkpoint_store(cache))
    assert processor.llm.chat.call_count == 3 and list(cache) == [0, 1]
    assert caught.value.director_audit["provider_response"]["text_chars"] == 27
    assert caught.value.director_audit["field_completion"]["fields"] == ["key_events", "story_map"]


def test_field_completion_uses_the_existing_step_budget():
    pipeline, _, processor = setup_pipeline()
    story = responses()[1]
    partial = {"timeline": [{"summary": "x" * 18000}], "relationships": story["relationships"]}
    missing = {"key_events": [{"summary": "x" * 7000}], "story_map": story["story_map"]}
    processor.llm.chat.side_effect = [json.dumps(step) for step in (responses()[0], partial, missing)]
    cache = {}
    with pytest.raises(ValueError, match="预算"):
        generate(pipeline, save_step=checkpoint_store(cache))
    assert processor.llm.chat.call_count == 3 and list(cache) == [0, 1]


def test_missing_fields_failure_has_specific_public_diagnostic_and_no_partial_checkpoint(tmp_path):
    pipeline, _, processor = setup_pipeline()
    partial = {key: responses()[1][key] for key in ("timeline", "relationships")}
    processor.llm.chat.side_effect = [json.dumps(step) for step in (responses()[0], partial, {})]
    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / "jobs.db", executor=executor)
        def work(job_id):
            return generate(pipeline, save_step=lambda i, key, value:
                store.save_batch("owner", "project", "director:missing", job_id, i, key, value))
        done = wait_done(store, store.start("owner", "project", "director:missing", work,
                                         pass_job_id=True, total_batches=4))
        assert done["status"] == "failed" and done["progress"]["completed"] == 2
        assert "补全结果缺少必填字段：key_events、story_map" in done["error"]
        assert "返回格式或引用校验未通过" not in done["error"]
        assert done["result"]["source_audit"]["field_contract"]["public_reason"] in done["error"]


@pytest.mark.parametrize("bad", [{"timeline": "invalid"}, {"story_map": None},
    {"timeline": [], "PRIVATE_EXTRA_FIELD": "no"}])
def test_invalid_existing_fields_are_not_sent_for_missing_field_completion(bad):
    pipeline, _, processor = setup_pipeline()
    processor.llm.chat.side_effect = [json.dumps(responses()[0]), json.dumps(bad)]
    with pytest.raises((ValueError, TypeError)):
        generate(pipeline)
    assert processor.llm.chat.call_count == 2


@pytest.mark.parametrize("finish_reason", ["content_filter", "sensitive"])
def test_continuity_refusal_preserves_three_steps_and_reports_model_rejection(tmp_path, finish_reason):
    from src.apps.comic_gen.llm_adapter import LLMResponseTerminationError
    pipeline, script, processor = setup_pipeline()
    original = script.model_dump()
    rejection = LLMResponseTerminationError(finish_reason)
    rejection.llm_diagnostic = {"stream": True, "finish_reason": finish_reason, "text_chars": 276}
    processor.llm.chat.side_effect = [json.dumps(step) for step in responses()[:2]] + [rejection]
    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / "jobs.db", executor=executor)
        def work(job_id):
            return generate(pipeline, cached=store.load_batches("owner", "project", "director:refusal"),
                save_step=lambda i, key, value: store.save_batch("owner", "project", "director:refusal", job_id, i, key, value))
        first = store.start("owner", "project", "director:refusal", work, pass_job_id=True, total_batches=4)
        failed = wait_done(store, first)
        assert failed["status"] == "failed"
        assert failed["progress"] == {"completed": 3, "total": 4, "stage": "continuity"}
        assert "所选模型拒绝处理" in failed["error"] and finish_reason in failed["error"]
        assert "JSON" not in failed["error"] and "流式响应中断" not in failed["error"]
        assert failed["result"]["source_audit"]["provider_response"]["finish_reason"] == finish_reason
        assert processor.llm.chat.call_count == 3
        saved = store.load_batches("owner", "project", "director:refusal")
        processor.llm.chat.reset_mock(side_effect=True)
        processor.llm.chat.side_effect = [json.dumps(responses()[2])]
        done = wait_done(store, store.start("owner", "project", "director:refusal", work, pass_job_id=True, total_batches=4))
        assert done["status"] == "completed" and processor.llm.chat.call_count == 1
        resumed = store.load_batches("owner", "project", "director:refusal")
        assert all(resumed[index] == saved[index] for index in (0, 1, 2))
        assert script.model_dump() == original


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
