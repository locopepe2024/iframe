import hashlib
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import (
    ArtDirection,
    Character,
    DirectorProfile,
    DirectorOverviewField,
    DirectorOverviewTemplate,
    DirectorStoryMap,
    DIRECTOR_STORY_MAP_EXECUTION_MAX_CHARS,
    DIRECTOR_EXECUTION_SUMMARY_MAX_CHARS,
    DIRECTOR_EXECUTION_SUMMARY_DEFAULT_MAX_CHARS,
    DIRECTOR_EXECUTION_SUMMARY_HARD_MAX_CHARS,
    DIRECTOR_EXECUTION_SUMMARY_MIN_CHARS,
    DIRECTOR_REFINE_CONTEXT_MAX_CHARS,
    DIRECTOR_CANON_STATE_MAX_ITEMS,
    DIRECTOR_CANON_STATE_MAX_CHARS,
    DIRECTOR_CANON_EXECUTION_MAX_CHARS,
    _coerce_director_execution_summary_limit,
    DIRECTOR_SCENE_SUMMARIES_MAX_CHARS,
    build_director_refinement_context,
    director_execution_payload,
    build_director_story_map_execution,
    merge_director_canon_state,
    merge_director_profile_patch,
    normalize_director_canon_state,
    Script,
    ScriptFactLedgerEntry,
    ScriptFactLedgerRevision,
    Series,
    normalize_director_profile_draft,
    normalize_director_profile_patch,
)
from src.apps.comic_gen.llm import (
    DIRECTOR_SOURCE_DIRECT_MAX_CHARS,
    build_visual_style_summary,
    ScriptProcessor,
    split_director_source,
)
from src.apps.identity import UserContext


def test_visual_style_summary_distinguishes_animation_and_live_action_without_changing_story_facts():
    anime = build_visual_style_summary({
        "category": "japanese_anime",
        "name_zh": "日式动漫",
        "description": "手绘线条与赛璐璐色块",
        "positive_prompt": "cel shading",
        "negative_prompt": "photorealistic",
    })
    live = build_visual_style_summary({
        "category": "live_action",
        "name_zh": "电影级写实",
        "positive_prompt": "natural skin texture",
    })
    assert "动画/图像化媒介" in anime
    assert "真人/电影化媒介" in live
    assert "不改变剧本事实" in anime
    assert "cel shading" in anime


def test_director_prompt_marks_series_scope_separately_from_episode_scope():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps(profile_payload(), ensure_ascii=False)

    processor.analyze_director_profile(
        "全剧资料。", {"characters": [], "scope": "series"}, {}
    )
    series_prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "Series 全剧导演理解" in series_prompt
    assert "不要把梗概中的结局当作第一集事实" in series_prompt

    processor.llm.chat.reset_mock()
    processor.analyze_director_profile(
        "本集剧本。", {"characters": [], "scope": "episode"}, {}
    )
    episode_prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "Episode 分集导演理解" in episode_prompt


def test_series_director_failure_retains_model_response_evidence():
    pipeline, _ = make_pipeline()
    series = Series(
        id="series", title="隔岸不观火", created_at=1, updated_at=1,
        source_context={"preamble": "全剧梗概"},
    )
    pipeline.series_store = {"series": series}
    pipeline.get_series_episodes = Mock(return_value=[])
    failure = ValueError("model response could not be admitted")
    pipeline.script_processor.analyze_director_profile_with_audit.side_effect = failure
    pipeline.script_processor._last_director_source_audit = {
        "source_mode": "direct", "source_char_count": 4,
    }
    pipeline.script_processor._last_director_raw_response = '{"setting":{}}'

    with pytest.raises(ValueError, match="could not be admitted") as raised:
        pipeline.preview_series_director_profile("series")

    assert raised.value.director_audit["raw_response"] == '{"setting":{}}'
    assert raised.value.director_audit["admission_status"] == "blocked"


def profile_payload():
    return {
        "setting": {
            "geography": "中国大学校园与北京",
            "era": "未确认",
            "cultural_context": "中国当代城市生活",
        },
        "timeline": [{"phase": "毕业前后", "change": "异地开始"}],
        "relationships": [{"people": ["沈夏", "周涵"], "arc": "距离→压力→沟通失效→关系消耗"}],
        "key_events": [{"scene": "21", "function": "分离起点", "weight": 5}],
        "emotional_arc": "温暖校园逐渐转为北京冷灰与孤独",
        "pacing": "克制，依靠停顿和空镜",
        "visual_language": "日式真人爱情电影的克制摄影语言，但故事地点不变",
        "performance_direction": "生活化表演，避免煽情",
        "dialogue_direction": "不发明剧本之外的冲突对白",
        "sound_direction": "用雨声、电话静默与城市底噪表现距离",
        "continuity_constraints": ["人物身份与中国地理连续"],
        "prohibitions": ["不引入日本招牌、校服、神社、樱花或社会习俗"],
        "unresolved_questions": ["故事准确年代"],
        "sample_plan": [{"seconds": "0-8", "scene": "21", "purpose": "离校"}],
    }


def structured_profile_payload():
    """Shape observed from the director model before draft normalization."""
    payload = profile_payload()
    payload.update({
        "emotional_arc": {"phase": "分开后", "feeling": "像熟悉的陌生人"},
        "pacing": {"before": "舒缓", "after": "克制疏离"},
        "visual_language": {"palette": "冷灰", "camera": "固定长镜头"},
        "performance_direction": {"principle": "减少外放情绪"},
        "dialogue_direction": {"principle": "保留停顿和未说出口的话"},
        "sound_direction": {"foreground": "雨声", "silence": "电话接通前的静默"},
    })
    return payload


def valid_story_map():
    return {
        "schema_version": 1,
        "source_revision": 1,
        "source_revision_id": "source-r1:test-hash",
        "fact_ledger_revision": None,
        "people": [{
            "person_id": "shen",
            "display_name": "沈夏",
            "variant_character_ids": ["shen"],
        }],
        "phases": [{
            "phase_id": "phase-campus",
            "order": 0,
            "label": "大学阶段",
            "time_anchor": "毕业前",
            "events": [{
                "event_id": "event-meet",
                "order": 0,
                "title": "相恋",
                "description": "沈夏与周涵成为情侣。",
                "character_ids": ["shen"],
                "dramatic_function": "建立亲密关系。",
                "source_fact_ids": [],
                "evidence_status": "interpretation",
            }],
        }],
        "relationship_arcs": [],
        "story_threads": [{
            "thread_id": "thread-main",
            "label": "沈夏的主线",
            "person_ids": ["shen"],
            "milestones": [{"event_id": "event-meet", "role": "setup", "note": ""}],
        }],
    }


def make_pipeline():
    from src.apps.comic_gen.pipeline import ComicGenPipeline
    from threading import RLock

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline.asset_generation_tasks = {}
    script = Script(
        id="film", title="隔岸不观火", original_text="场景21至44",
        created_at=1, updated_at=1,
        characters=[Character(id="shen", name="沈夏", description="温婉")],
        art_direction=ArtDirection(
            selected_style_id="jp-live-action",
            style_config={"name": "日式真人爱情", "positive_prompt": "restrained Japanese live-action romance"},
        ),
    )
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_episode_assets = Mock(return_value={
        "characters": script.characters, "scenes": [], "props": [],
    })
    pipeline.get_effective_prompt = Mock(return_value="storyboard prompt")
    pipeline._save_data = Mock()
    pipeline.script_processor = Mock()
    return pipeline, script


def test_director_overview_template_inherits_series_and_preserves_confirmed_profile():
    pipeline, script = make_pipeline()
    script.series_id = "wulin"
    original = DirectorProfile(**normalize_director_profile_draft(profile_payload()))
    script.art_direction.director_profile = original
    series = Series(id="wulin", title="武林传·苍桐", created_at=1, updated_at=1)
    pipeline.series_store = {"wulin": series}
    template = DirectorOverviewTemplate(fields=[
        DirectorOverviewField(key="jianghu_rules", label="江湖秩序", purpose="区分朝堂与江湖规则"),
        DirectorOverviewField(key="time_period", label="时代范围", purpose="只记录原文明确的年代"),
    ])

    assert pipeline.effective_director_overview_template(script).fields[0].key == "format_genre"
    pipeline._save_series_data_unlocked = Mock()
    pipeline.save_series_director_overview_template("wulin", template)
    assert pipeline.effective_director_overview_template(script).fields[0].key == "jianghu_rules"
    pipeline.save_director_overview_template("film", DirectorOverviewTemplate(revision=2, fields=[
        DirectorOverviewField(key="character_contrast", label="人物对照", purpose="只记录有依据的关系对照"),
    ]))
    assert pipeline.effective_director_overview_template(script).fields[0].key == "character_contrast"
    with pytest.raises(ValueError, match="revision changed"):
        pipeline.save_director_overview_template("film", template)
    assert script.art_direction.director_profile is original


def test_current_wulin_script_director_prompt_uses_custom_overview_without_making_style_a_fact():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps(profile_payload(), ensure_ascii=False)
    source = (
        "第1集 寒痕初现，赤焰逢锋\n"
        "大靖年间，江湖风雨飘摇，各派林立，正邪交错。"
        "暮秋时节，残阳如血，铺洒在青溪镇的青石板长街上。"
        "苏砚在粮铺前制服悍匪，江灼随后与他交手。"
    )
    template = DirectorOverviewTemplate(fields=[
        DirectorOverviewField(key="jianghu_rules", label="江湖秩序", purpose="仅依据原文区分朝堂与江湖规则"),
        DirectorOverviewField(key="dramatic_contrast", label="人物对照", purpose="比较苏砚和江灼的行动及误解"),
        DirectorOverviewField(key="spatial_motif", label="空间意象", purpose="无反复出现的空间时留空", enabled=False),
    ])
    processor.analyze_director_profile(source, {
        "characters": [{"name": "苏砚"}, {"name": "江灼"}],
        "_director_overview_template": template.model_dump(),
    }, {"name_zh": "中式武侠动漫", "positive_prompt": "Chinese wuxia animation"})
    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert source in prompt
    assert '"key":"jianghu_rules"' in prompt
    assert '"enabled":false' in prompt
    assert "中式武侠动漫" in prompt
    assert "视觉风格只描述摄影、表演、色彩、材质和声音语言" in prompt
    assert '"_director_overview_template"' not in prompt.split("<entities>", 1)[1].split("</entities>", 1)[0]


def test_director_refinement_prompt_contains_source_entities_style_draft_and_history():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.side_effect = lambda **kwargs: (
        json.dumps({"summary": "短片段摘要", "continuity_in": "", "continuity_out": "", "facts": [], "open_threads": []}, ensure_ascii=False)
        if "<source_chunk" in kwargs["messages"][0]["content"]
        else json.dumps(profile_payload(), ensure_ascii=False)
    )

    result = processor.refine_director_profile(
        "场景21 周涵离校",
        {"characters": [{"name": "沈夏"}]},
        {"name": "日式真人爱情", "positive_prompt": "restrained"},
        profile_payload(),
        ["故事仍发生在中国", "突出未接来电"],
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "场景21 周涵离校" in prompt
    assert "沈夏" in prompt
    assert "日式真人爱情" in prompt
    assert "距离→压力→沟通失效→关系消耗" in prompt
    assert "1. 故事仍发生在中国" in prompt and "2. 突出未接来电" in prompt
    assert "execution_summary" in prompt
    assert str(DIRECTOR_EXECUTION_SUMMARY_MAX_CHARS) in prompt
    assert "canon_state" in prompt
    assert str(DIRECTOR_CANON_STATE_MAX_ITEMS) in prompt
    assert str(DIRECTOR_CANON_STATE_MAX_CHARS) in prompt
    assert "sample_plan 最多 4 项" in prompt
    assert "导演风格、剪辑结构、样片时长和取材范围属于执行约束" in prompt
    assert "首尾框架式回忆/书挡式叙事（Bookend Narrative Technique）" in prompt
    assert "现实/当下开头锚点" in prompt
    assert "不是默认的‘回忆录风格’" in prompt
    assert "用户没有明确标注该结构时，不得自行套用" in prompt
    assert '<stage_preset name="director-interpretation">' in prompt
    assert '<stage_preset name="director-intent">' in prompt
    assert processor.llm.chat.call_args.kwargs["timeout_seconds"] == 1800
    assert processor.llm.chat.call_args.kwargs["max_retries"] == 1
    assert result["setting"]["geography"] == "中国大学校园与北京"


def test_director_analysis_prompt_defines_bookend_as_optional_structure():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps(profile_payload(), ensure_ascii=False)

    processor.analyze_director_profile(
        "开头：公墓。中段：战争往事。结尾：回到公墓。",
        {"characters": [{"name": "老兵"}]},
        {"name": "现实主义", "positive_prompt": "restrained"},
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "Bookend Narrative Technique" in prompt
    assert "canon_state" in prompt
    assert "不是默认的‘回忆录风格’" in prompt
    assert "用户没有明确标注该结构时，不得自行套用" in prompt


def test_director_preview_normalizes_structured_text_fields_without_losing_content():
    pipeline, _ = make_pipeline()
    pipeline.script_processor.analyze_director_profile.return_value = structured_profile_payload()

    result = pipeline.preview_director_profile("film")

    assert isinstance(result["emotional_arc"], str)
    assert "熟悉的陌生人" in result["emotional_arc"]
    assert "冷灰" in result["visual_language"]
    DirectorProfile(**result)


def test_director_preview_moves_unknown_character_refs_to_unresolved_list():
    pipeline, _ = make_pipeline()
    payload = profile_payload()
    payload["story_map"] = valid_story_map()
    payload["story_map"]["source_revision_id"] = ""
    payload["story_map"]["people"] = []
    payload["story_map"]["story_threads"] = []
    payload["story_map"]["phases"][0]["events"][0]["character_ids"] = ["shen", "model-person-1"]
    pipeline.script_processor.analyze_director_profile.return_value = payload

    script = pipeline.scripts["film"]
    pipeline._bind_director_story_map(script, {"characters": script.characters}, payload)

    event = payload["story_map"]["phases"][0]["events"][0]
    assert event["character_ids"] == ["shen"]
    assert event["unresolved_character_refs"] == ["model-person-1"]


def test_director_binding_moves_unknown_relationship_person_to_unresolved_list():
    pipeline, _ = make_pipeline()
    script = pipeline.scripts["film"]
    payload = profile_payload()
    payload["story_map"] = valid_story_map()
    payload["story_map"]["source_revision_id"] = ""
    payload["story_map"]["relationship_arcs"] = [{
        "relationship_id": "arc-1",
        "person_ids": ["shen", "model-person-1"],
        "states": [],
    }]
    pipeline._bind_director_story_map(script, {"characters": script.characters}, payload)
    arc = payload["story_map"]["relationship_arcs"][0]
    assert arc["person_ids"] == ["shen"]
    assert arc["unresolved_person_refs"] == ["model-person-1"]
    DirectorProfile(**normalize_director_profile_draft(payload))


def test_director_binding_resolves_semantic_character_and_person_refs():
    pipeline, _ = make_pipeline()
    script = pipeline.scripts["film"]
    payload = profile_payload()
    payload["story_map"] = valid_story_map()
    payload["story_map"]["source_revision_id"] = ""
    payload["story_map"]["people"] = []
    payload["story_map"]["phases"][0]["events"][0]["character_ids"] = []
    payload["story_map"]["phases"][0]["events"][0]["character_refs"] = ["沈夏"]
    payload["story_map"]["relationship_arcs"] = [{
        "relationship_id": "arc-1",
        "person_refs": ["沈夏", "未知人物"],
        "states": [],
    }]
    pipeline._bind_director_story_map(script, {"characters": script.characters}, payload)
    event = payload["story_map"]["phases"][0]["events"][0]
    assert event["character_ids"] == ["shen"]
    arc = payload["story_map"]["relationship_arcs"][0]
    assert arc["person_ids"] == ["shen"]
    assert arc["unresolved_person_refs"] == ["未知人物"]


def test_director_binding_keeps_extra_relationship_refs_for_review():
    pipeline, _ = make_pipeline()
    script = pipeline.scripts["film"]
    payload = profile_payload()
    payload["story_map"] = valid_story_map()
    payload["story_map"]["source_revision_id"] = ""
    payload["story_map"]["relationship_arcs"] = [{
        "relationship_id": "arc-1",
        "person_refs": ["沈夏", "周涵", "张姐", "孙毅", "公司老板"],
        "states": [],
    }]
    pipeline._bind_director_story_map(script, {"characters": script.characters}, payload)
    arc = payload["story_map"]["relationship_arcs"][0]
    assert arc["person_ids"] == ["shen"]
    assert arc["unresolved_person_refs"] == ["周涵", "张姐", "孙毅", "公司老板"]


def test_director_refine_normalizes_model_output_and_draft_before_calling_llm():
    pipeline, _ = make_pipeline()
    pipeline.script_processor.refine_director_profile.return_value = structured_profile_payload()
    draft = structured_profile_payload()

    result = pipeline.refine_director_profile("film", draft, ["增加分开后的陌路人感觉"])

    sent_draft = pipeline.script_processor.refine_director_profile.call_args.args[3]
    assert isinstance(sent_draft["emotional_arc"], str)
    assert "熟悉的陌生人" in sent_draft["emotional_arc"]
    assert isinstance(result["sound_direction"], str)
    assert "电话接通前的静默" in result["sound_direction"]
    DirectorProfile(**result)


def test_pipeline_merges_a_director_delta_into_the_visible_full_draft():
    pipeline, _ = make_pipeline()
    pipeline.script_processor.refine_director_profile.return_value = {
        "pacing": "更克制，减少解释性剪辑",
    }
    draft = profile_payload()

    result = pipeline.refine_director_profile("film", draft, ["减少解释性剪辑"])

    assert result["pacing"] == "更克制，减少解释性剪辑"
    assert result["visual_language"] == draft["visual_language"]
    assert result["key_events"] == draft["key_events"]
    assert result["execution_summary"]


def test_director_refinement_patch_merges_without_synthesizing_omitted_fields():
    base = normalize_director_profile_draft(profile_payload())

    patch = normalize_director_profile_patch({
        "pacing": {"after": "更克制"},
        "extra_model_commentary": "不得进入 profile",
    })
    merged = merge_director_profile_patch(base, patch)

    assert patch == {"pacing": '{"after": "更克制"}'}
    assert merged["pacing"] == '{"after": "更克制"}'
    assert merged["visual_language"] == base["visual_language"]
    assert merged["execution_summary"] == base["execution_summary"]
    assert "extra_model_commentary" not in merged


def test_director_refinement_drops_a_full_profile_echo_before_merging():
    base = normalize_director_profile_draft(profile_payload())
    echoed = {**base, "pacing": "只改变节奏"}

    merged = merge_director_profile_patch(base, echoed)

    assert merged["pacing"] == "只改变节奏"
    assert merged["visual_language"] == base["visual_language"]
    assert merged["key_events"] == base["key_events"]


def test_director_refinement_context_is_bounded_and_keeps_canonical_summary_layers():
    import json

    context = build_director_refinement_context({
        **profile_payload(),
        "execution_summary": "全局摘要" * 5000,
        "timeline": [{"phase": "legacy", "change": "LEGACY-TAIL" * 5000} for _ in range(20)],
        "sample_plan": [{"seconds": "0-60", "detail": "样片" * 5000} for _ in range(20)],
        "scene_summaries": [{
            "scene_ref": str(index),
            "summary": "局部事件" * 100,
            "state_in": "入场" * 100,
            "state_out": "出场" * 100,
        } for index in range(30)],
    })
    serialized = json.dumps(context, ensure_ascii=False, separators=(",", ":"))

    assert len(serialized) <= DIRECTOR_REFINE_CONTEXT_MAX_CHARS
    assert "execution_summary" in context
    assert "scene_summaries" in context
    assert ("LEGACY-TAIL" * 100) not in serialized


def test_canon_state_normalization_is_bounded_and_source_linked():
    raw = {
        "characters": [
            {
                "fact_id": f"character-{index}",
                "kind": "identity",
                "subject": f"人物{index}",
                "value": "长事实" * 500,
                "source_refs": ["scene-1", "scene-2"],
                "source_revision": 4,
                "status": "active",
                "supersedes_fact_id": "character-old" if index == 0 else None,
                "private_note": "不得进入 canon projection",
            }
            for index in range(DIRECTOR_CANON_STATE_MAX_ITEMS + 8)
        ],
        "uncertainties": [{"subject": "年代", "value": "未明确"}],
    }

    normalized = normalize_director_canon_state(raw)
    serialized = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))

    assert sum(len(items) for items in normalized.values()) <= DIRECTOR_CANON_STATE_MAX_ITEMS
    assert len(serialized) <= DIRECTOR_CANON_STATE_MAX_CHARS
    first = normalized["characters"][0]
    assert first["source_refs"] == ["scene-1", "scene-2"]
    assert first["source_revision"] == 4
    assert first["status"] == "active"
    assert first["supersedes_fact_id"] == "character-old"
    assert "private_note" not in first


def test_canon_fact_ids_do_not_change_when_facts_are_reordered():
    facts = [
        {"kind": "identity", "subject": "沈夏", "value": "大学生"},
        {"kind": "identity", "subject": "周涵", "value": "离校后异地"},
    ]

    first = normalize_director_canon_state({"characters": facts})
    reordered = normalize_director_canon_state({"characters": list(reversed(facts))})
    first_ids = {item["subject"]: item["fact_id"] for item in first["characters"]}
    reordered_ids = {item["subject"]: item["fact_id"] for item in reordered["characters"]}

    assert reordered_ids == first_ids


def test_canon_merge_replaces_same_fact_and_appends_new_fact():
    base = {
        "characters": [{
            "fact_id": "character-shen",
            "subject": "沈夏",
            "value": "仍在校园",
            "source_refs": ["scene-1"],
            "status": "active",
        }],
        "events": [{
            "fact_id": "event-graduation",
            "subject": "毕业",
            "value": "尚未发生",
            "status": "uncertain",
        }],
    }
    patch = {
        "characters": [{
            "fact_id": "character-shen",
            "subject": "沈夏",
            "value": "已经离校",
            "source_refs": ["scene-21"],
            "source_revision": 2,
            "status": "active",
            "supersedes_fact_id": "character-shen-old",
        }, {
            "fact_id": "character-zhou",
            "subject": "周涵",
            "value": "开始异地",
            "source_refs": ["scene-21"],
            "status": "active",
        }],
    }

    merged = merge_director_canon_state(base, patch)

    assert [item["fact_id"] for item in merged["characters"]] == [
        "character-shen", "character-zhou",
    ]
    assert merged["characters"][0]["value"] == "已经离校"
    assert merged["characters"][0]["supersedes_fact_id"] == "character-shen-old"
    assert merged["events"][0]["fact_id"] == "event-graduation"


def test_unchanged_canon_echo_is_dropped_from_refinement_patch():
    base = normalize_director_profile_draft({
        **profile_payload(),
        "canon_state": {
            "characters": [{
                "fact_id": "character-shen",
                "subject": "沈夏",
                "value": "仍在校园",
                "source_refs": ["scene-1"],
                "status": "active",
            }],
        },
    })

    merged = merge_director_profile_patch(base, {
        "canon_state": base["canon_state"],
    })

    assert merged == base


def test_downstream_canon_projection_is_compact_and_never_forwards_unknown_fields():
    profile = DirectorProfile(**{
        **profile_payload(),
        "canon_state": {
            "characters": [{
                "fact_id": "character-shen",
                "subject": "沈夏",
                "value": "中国大学生",
                "source_refs": ["scene-1"],
                "status": "active",
                "private_note": "不得传给分镜",
            }],
            "unknown_category": [{"value": "不得传给分镜"}],
        },
    })

    execution = director_execution_payload(profile)
    serialized = json.dumps(execution["canon_state"], ensure_ascii=False, separators=(",", ":"))

    assert len(serialized) <= DIRECTOR_CANON_EXECUTION_MAX_CHARS
    assert "private_note" not in serialized
    assert "不得传给分镜" not in serialized
    assert execution["canon_state"]["characters"][0]["source_refs"] == ["scene-1"]


def test_refinement_context_includes_compact_canon_state():
    context = build_director_refinement_context({
        **profile_payload(),
        "canon_state": {
            "characters": [{
                "fact_id": "character-shen",
                "subject": "沈夏",
                "value": "已经离校",
                "source_refs": ["scene-21"],
                "source_revision": 3,
                "status": "active",
            }],
        },
    })
    serialized = json.dumps(context, ensure_ascii=False, separators=(",", ":"))

    assert len(serialized) <= DIRECTOR_REFINE_CONTEXT_MAX_CHARS
    assert context["canon_state"]["characters"][0]["fact_id"] == "character-shen"
    assert context["canon_state"]["characters"][0]["source_revision"] == 3


def test_director_refinement_prompt_requests_delta_not_full_profile_echo():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = "{}"
    oversized = {
        **profile_payload(),
        "timeline": [{"phase": "legacy", "change": "LEGACY-TAIL" * 5000} for _ in range(20)],
    }

    result = processor.refine_director_profile(
        "场景21 周涵离校",
        {"characters": [{"name": "沈夏"}]},
        {"name": "日式真人爱情", "positive_prompt": "restrained"},
        oversized,
        ["只调整节奏"],
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert result == {}
    assert "<current_director_profile_context>" in prompt
    assert "<current_director_profile>" not in prompt
    assert "只返回因本次 revision_instructions 发生变化的顶层字段" in prompt
    assert "不要回显未变化的字段" in prompt
    assert ("LEGACY-TAIL" * 100) not in prompt


def test_director_refinement_bounds_legacy_accumulated_instruction_history():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = "{}"
    old = "旧要求" * 1200
    newest = "最新要求" * 1200

    processor.refine_director_profile(
        "场景21 周涵离校",
        {"characters": []},
        {"name": "现实主义"},
        profile_payload(),
        [old, newest],
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "最新要求" in prompt
    assert "旧要求" not in prompt


def test_legacy_profile_gets_bounded_execution_payload_without_full_profile_fields():
    payload = profile_payload()
    payload["sample_plan"] = [{"seconds": str(index), "detail": "细节" * 2000} for index in range(4)]

    execution = director_execution_payload(DirectorProfile(**payload))

    assert set(execution) == {
        "revision", "content_hash", "execution_summary", "scene_summaries", "canon_state",
    }
    assert len(execution["execution_summary"]) <= DIRECTOR_EXECUTION_SUMMARY_MAX_CHARS
    assert "中国大学校园与北京" in execution["execution_summary"]
    assert execution["scene_summaries"]
    assert execution["scene_summaries"][0]["scene_ref"] == "21"


def test_current_director_edits_are_appended_when_old_execution_summary_exists():
    payload = {
        **profile_payload(),
        "execution_summary": "模型生成的旧摘要",
        "setting": {"time_period": "2014—2024", "social_context": "移动互联网普及"},
        "timeline": [{"phase": "北京职场", "time_anchor": "2020 年"}],
        "continuity_constraints": ["周涵在职场阶段留短发，婚礼阶段恢复长发"],
        "unresolved_questions": ["各阶段是否分别对应 2014、2018、2020、2024？"],
    }

    execution = director_execution_payload(DirectorProfile(**payload))

    assert "模型生成的旧摘要" in execution["execution_summary"]
    assert "周涵在职场阶段留短发" in execution["execution_summary"]
    assert "2014—2024" in execution["execution_summary"]
    assert "各阶段是否分别对应" in execution["execution_summary"]


def test_scene_memory_is_bounded_and_keeps_transition_fields():
    payload = {
        **profile_payload(),
        "scene_summaries": [
            {
                "scene_ref": f"scene-{index}",
                "summary": "局部事件" * 100,
                "state_in": "入场状态" * 100,
                "state_out": "出场状态" * 100,
                "extra_detail": "不得进入下游" * 100,
            }
            for index in range(30)
        ],
    }

    execution = director_execution_payload(DirectorProfile(**payload))
    serialized = json.dumps(execution["scene_summaries"], ensure_ascii=False, separators=(",", ":"))

    assert len(serialized) <= DIRECTOR_SCENE_SUMMARIES_MAX_CHARS
    assert len(execution["scene_summaries"]) == 16
    assert set(execution["scene_summaries"][0]) <= {
        "scene_ref", "summary", "state_in", "state_out",
    }
    assert execution["scene_summaries"][0]["state_in"]
    assert execution["scene_summaries"][0]["state_out"]


def test_legacy_scene_memory_uses_global_fallback_when_no_local_events_exist():
    execution = director_execution_payload(DirectorProfile(
        execution_summary="只保留全局连续性规则。",
    ))

    assert execution["scene_summaries"] == [{
        "scene_ref": "__global__",
        "summary": "只保留全局连续性规则。",
    }]


def test_model_summary_is_clipped_during_draft_normalization():
    normalized = normalize_director_profile_draft({
        **profile_payload(),
        "execution_summary": "摘要" * 5000,
    })

    assert len(normalized["execution_summary"]) == DIRECTOR_EXECUTION_SUMMARY_MAX_CHARS
    DirectorProfile(**normalized)


def test_director_normalization_derives_storyline_and_scene_memory_when_model_omits_them():
    draft = normalize_director_profile_draft({
        **profile_payload(),
        "story_map": {
            **valid_story_map(),
            "story_threads": [],
        },
        "scene_summaries": [],
    })

    assert draft["story_map"]["story_threads"]
    assert draft["story_map"]["story_threads"][0]["milestones"][0]["event_id"] == "event-meet"
    assert draft["scene_summaries"]
    assert draft["scene_summaries"][0]["scene_ref"] == "大学阶段 · event-meet"


def test_scene_memory_uses_story_map_events_when_top_level_scene_fields_are_empty():
    profile = {
        "story_map": {
            **valid_story_map(),
            "story_threads": [],
        },
        "scene_summaries": [],
    }
    normalized = normalize_director_profile_draft(profile)
    assert normalized["scene_summaries"]
    assert normalized["scene_summaries"][0]["scene_ref"] == "大学阶段 · event-meet"
    assert normalized["story_map"]["story_threads"]


def test_story_map_validates_stable_references_and_rejects_cross_phase_relationship_triggers():
    story_map = valid_story_map()
    DirectorStoryMap(**story_map)

    invalid = {
        **story_map,
        "people": [
            *story_map["people"],
            {"person_id": "zhou", "display_name": "周涵", "variant_character_ids": ["zhou"]},
        ],
        "phases": [
            story_map["phases"][0],
            {"phase_id": "phase-after", "order": 1, "label": "后来", "events": []},
        ],
        "relationship_arcs": [{
            "relationship_id": "shen__zhou",
            "person_ids": ["shen", "shen"],
            "states": [{
                "phase_id": "phase-after",
                "state": "分开",
                "trigger_event_ids": ["event-meet"],
            }],
        }],
    }
    with pytest.raises(ValueError, match="two different people"):
        DirectorStoryMap(**invalid)

    invalid["relationship_arcs"][0]["person_ids"] = ["shen", "zhou"]
    with pytest.raises(ValueError, match="outside its phase"):
        DirectorStoryMap(**invalid)


def test_director_profile_normalizes_model_arc_id_alias():
    payload = profile_payload()
    payload["story_map"] = valid_story_map()
    payload["story_map"]["people"].append({
        "person_id": "zhou",
        "display_name": "周涵",
        "variant_character_ids": ["zhou"],
    })
    payload["story_map"]["relationship_arcs"] = [{
        "arc_id": "arc-shen-zhou",
        "person_ids": ["shen", "zhou"],
        "states": [],
    }]
    normalized = normalize_director_profile_draft(payload)
    assert normalized["story_map"]["relationship_arcs"][0]["relationship_id"] == "arc-shen-zhou"
    assert "arc_id" not in normalized["story_map"]["relationship_arcs"][0]
    DirectorProfile(**normalized)


def test_director_profile_direct_validation_accepts_model_arc_id_alias():
    payload = profile_payload()
    payload["story_map"] = valid_story_map()
    payload["story_map"]["people"].append({
        "person_id": "zhou",
        "display_name": "周涵",
        "variant_character_ids": ["zhou"],
    })
    payload["story_map"]["relationship_arcs"] = [{
        "arc_id": "arc-direct-validation",
        "person_ids": ["shen", "zhou"],
        "states": [],
    }]
    profile = DirectorProfile(**payload)
    assert profile.story_map.relationship_arcs[0].relationship_id == "arc-direct-validation"


def test_director_profile_rejects_conflicting_relationship_arc_aliases():
    payload = profile_payload()
    payload["story_map"] = valid_story_map()
    payload["story_map"]["people"].append({
        "person_id": "zhou",
        "display_name": "周涵",
        "variant_character_ids": ["zhou"],
    })
    payload["story_map"]["relationship_arcs"] = [{
        "relationship_id": "canonical-id",
        "arc_id": "different-id",
        "person_ids": ["shen", "zhou"],
        "states": [],
    }]
    with pytest.raises(ValueError, match="must match"):
        DirectorProfile(**payload)


def test_director_profile_accepts_relationship_arc_evidence_status():
    payload = profile_payload()
    payload["story_map"] = valid_story_map()
    payload["story_map"]["people"].append({
        "person_id": "zhou",
        "display_name": "周涵",
        "variant_character_ids": ["zhou"],
    })
    payload["story_map"]["relationship_arcs"] = [{
        "relationship_id": "arc-with-evidence",
        "person_ids": ["shen", "zhou"],
        "evidence_status": "interpretation",
        "states": [],
    }]
    profile = DirectorProfile(**payload)
    assert profile.story_map.relationship_arcs[0].evidence_status == "interpretation"


def test_normalize_director_profile_accepts_thread_status_alias_and_preserves_raw_label():
    payload = profile_payload()
    story_map = valid_story_map()
    story_map["story_threads"] = [{
        "thread_id": "thread-main",
        "label": "主线",
        "status": "summary_supported",
        "milestones": [{"event_id": "event-meet", "role": "setup"}],
    }]
    payload["story_map"] = story_map
    normalized = normalize_director_profile_draft(payload)
    thread = normalized["story_map"]["story_threads"][0]
    assert thread["evidence_status"] == "interpretation"
    assert thread["evidence_status_raw"] == "summary_supported"
    assert DirectorProfile(**normalized).story_map.story_threads[0].evidence_status == "interpretation"


def test_director_profile_keeps_relationship_state_without_model_description():
    payload = profile_payload()
    payload["story_map"] = valid_story_map()
    payload["story_map"]["people"].append({
        "person_id": "zhou", "display_name": "周涵", "variant_character_ids": ["zhou"],
    })
    payload["story_map"]["relationship_arcs"] = [{
        "relationship_id": "arc-incomplete",
        "person_ids": ["shen", "zhou"],
        "states": [{"phase_id": "phase-campus", "trigger_event_ids": ["event-meet"]}],
    }]
    profile = DirectorProfile(**normalize_director_profile_draft(payload))
    assert profile.story_map.relationship_arcs[0].states[0].state == ""


def test_normalize_director_profile_maps_summary_supported_to_interpretation():
    payload = profile_payload()
    story_map = valid_story_map()
    story_map["people"].append({"person_id": "zhou", "display_name": "周涵", "variant_character_ids": ["zhou"]})
    story_map["phases"][0]["events"][0]["evidence_status"] = "summary_supported"
    story_map["relationship_arcs"] = [{
        "relationship_id": "arc-summary-supported",
        "person_ids": ["shen", "zhou"],
        "evidence_status": "summary_supported",
        "states": [{"phase_id": "phase-campus", "state": "相互试探", "evidence_status": "summary_supported"}],
    }]
    payload["story_map"] = story_map
    normalized = normalize_director_profile_draft(payload)
    assert normalized["story_map"]["phases"][0]["events"][0]["evidence_status"] == "interpretation"
    assert normalized["story_map"]["relationship_arcs"][0]["evidence_status"] == "interpretation"
    assert normalized["story_map"]["relationship_arcs"][0]["states"][0]["evidence_status"] == "interpretation"
    DirectorProfile(**normalized)


def test_normalize_director_profile_accepts_arbitrary_non_empty_model_evidence_label():
    payload = profile_payload()
    story_map = valid_story_map()
    story_map["phases"][0]["events"][0]["evidence_status"] = "model_confident_summary"
    payload["story_map"] = story_map
    normalized = normalize_director_profile_draft(payload)
    event = normalized["story_map"]["phases"][0]["events"][0]
    assert event["evidence_status"] == "interpretation"
    assert event["evidence_status_raw"] == "model_confident_summary"
    DirectorProfile(**normalized)


def test_director_story_map_execution_projection_is_bounded_and_preserves_story_structure():
    projected = build_director_story_map_execution(valid_story_map())

    assert projected["phases"][0]["events"][0]["event_id"] == "event-meet"
    assert projected["people"][0]["variant_character_ids"] == ["shen"]
    assert projected["story_threads"][0]["milestones"][0]["event_id"] == "event-meet"

    oversized = {
        "schema_version": 1,
        "source_revision": 1,
        "source_revision_id": "source-r1:test-hash",
        "fact_ledger_revision": None,
        "people": [
            {"person_id": f"person-{index}", "display_name": "人" * 160, "variant_character_ids": []}
            for index in range(100)
        ],
        "phases": [],
        "relationship_arcs": [],
        "story_threads": [],
    }
    bounded = build_director_story_map_execution(oversized)
    assert len(json.dumps(bounded, ensure_ascii=False, separators=(",", ":"))) <= DIRECTOR_STORY_MAP_EXECUTION_MAX_CHARS


def test_director_summary_budget_defaults_to_7000_and_clamps_configuration():
    assert DIRECTOR_EXECUTION_SUMMARY_DEFAULT_MAX_CHARS == 7000
    assert _coerce_director_execution_summary_limit(None) == 7000
    assert _coerce_director_execution_summary_limit("9000") == 9000
    assert _coerce_director_execution_summary_limit("not-a-number") == 7000
    assert _coerce_director_execution_summary_limit("1") == DIRECTOR_EXECUTION_SUMMARY_MIN_CHARS
    assert _coerce_director_execution_summary_limit("999999") == DIRECTOR_EXECUTION_SUMMARY_HARD_MAX_CHARS


def test_storyboard_prompt_filters_full_profile_to_execution_summary():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps({"frames": [{
        "scene_ref_name": "场景21", "action_summary": "离校",
        "visual_atmosphere": "冷灰校园，傍晚空气沉静",
        "character_acting": "周涵低头收拾书包，目光克制而疲惫",
        "key_action_physics": "他提起书包，肩带因重量轻微绷紧",
        "lighting": {"direction": "侧后方", "quality": "soft", "color_temp": "cool", "description": "冷色侧光拉长影子"},
    }]})
    payload = {
        **profile_payload(),
        "script_fact_ledger": {
            "status": "current",
            "ledger_revision": 2,
            "source_revision": 1,
            "facts": [{
                "fact_id": "fact-1",
                "evidence_status": "uncertain",
                "value": {"claim": "季节未确认"},
            }],
        },
        "execution_summary": "只保留中国背景、关系疏离、冷灰视觉和未接来电；用户要求：首尾框架式回忆，约60秒。",
        "scene_summaries": [{
            "scene_ref": "场景21",
            "summary": "周涵离校，关系进入分离阶段。",
            "state_in": "仍在校园，关系尚未断裂。",
            "state_out": "离校后开始异地。",
        }],
        "sample_plan": [{"bulk": "不要注入下游" * 3000}],
    }

    result = processor.analyze_to_storyboard(
        "场景21 周涵离校", {"characters": []}, director_profile=payload
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert result[0]["action_summary"] == "离校"
    assert "只保留中国背景" in prompt
    assert "confirmed_director_execution_summary" in prompt
    assert "不要注入下游" not in prompt
    assert '"sample_plan"' not in prompt
    assert "场景21" in prompt
    assert "state_out" in prompt
    assert "首尾框架式回忆" in prompt
    assert "未标注时不得自行套用" in prompt
    assert '"script_fact_ledger"' in prompt
    assert "uncertain 和 conflicted 只提示核查方向" in prompt


def test_bookend_narrative_is_an_explicit_scoped_constraint_not_a_global_style():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps(profile_payload(), ensure_ascii=False)

    processor.refine_director_profile(
        "开头：公墓。中段：战争往事。结尾：回到公墓。",
        {"characters": [{"name": "老兵"}]},
        {"name": "现实主义", "positive_prompt": "restrained"},
        profile_payload(),
        ["制作约1分钟样片，使用首尾框架式回忆（书挡式叙事 / Bookend Narrative Technique），只作用于样片。"],
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "只在用户指定的样片或段落范围内生效" in prompt
    assert "回忆内容必须来自原文" in prompt
    assert "只作用于样片" in prompt


def test_apply_director_profile_saves_exact_draft_and_marks_existing_work_for_review():
    pipeline, script = make_pipeline()
    script.frames = [Mock(director_review_required=False)]
    draft = profile_payload()

    result = pipeline.apply_director_profile("film", draft)

    expected_hash = hashlib.sha256(
        json.dumps(draft, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert result.art_direction.director_profile.content_hash == expected_hash
    assert result.art_direction.director_profile.revision == 1
    assert result.art_direction.director_profile.setting == draft["setting"]
    assert result.director_review_required is True
    assert result.frames[0].director_review_required is True
    pipeline._save_data.assert_called_once()


def test_director_profile_draft_persists_separately_and_requires_current_revisions():
    pipeline, script = make_pipeline()
    draft = profile_payload()

    saved = pipeline.save_director_profile_draft("film", script.source_revision, 0, draft)

    assert saved.director_profile_draft_revision == 1
    assert saved.director_profile_draft_source_revision == script.source_revision
    assert saved.director_profile_draft.setting == draft["setting"]
    assert saved.art_direction.director_profile is None

    with pytest.raises(ValueError, match="draft revision changed"):
        pipeline.save_director_profile_draft("film", script.source_revision, 0, draft)

    active = pipeline.apply_director_profile(
        "film", draft, expected_current_revision=0, expected_draft_revision=1,
    )
    assert active.art_direction.director_profile.revision == 1
    assert active.director_profile_revisions[-1].profile.pacing == draft["pacing"]


def test_story_map_draft_is_saved_and_confirmed_as_part_of_the_director_revision():
    pipeline, script = make_pipeline()
    story_map = valid_story_map()
    story_map["source_revision_id"] = ""
    draft = {**profile_payload(), "story_map": story_map}

    saved = pipeline.save_director_profile_draft("film", script.source_revision, 0, draft)
    assert saved.director_profile_draft.story_map.phases[0].events[0].event_id == "event-meet"
    assert saved.director_profile_draft.story_map.source_revision_id == pipeline.source_revision_id(
        script, script.source_revision
    )

    confirmed = pipeline.apply_director_profile(
        "film", draft, expected_current_revision=0, expected_draft_revision=1,
    )
    assert confirmed.art_direction.director_profile.story_map.phases[0].events[0].event_id == "event-meet"
    assert confirmed.art_direction.director_profile.content_hash != ""


def test_incomplete_story_map_can_be_saved_as_a_draft_but_not_confirmed():
    pipeline, script = make_pipeline()
    story_map = valid_story_map()
    story_map["source_revision_id"] = ""
    story_map["phases"][0]["label"] = ""
    story_map["phases"][0]["events"][0]["description"] = ""
    story_map["phases"][0]["events"][0]["evidence_status"] = "explicit"
    draft = {**profile_payload(), "story_map": story_map}

    saved = pipeline.save_director_profile_draft("film", script.source_revision, 0, draft)
    assert saved.director_profile_draft_revision == 1
    with pytest.raises(ValueError, match="Name every story phase"):
        pipeline.apply_director_profile(
            "film", draft, expected_current_revision=0, expected_draft_revision=1,
        )


def test_story_map_cannot_link_to_a_rejected_fact_ledger_entry():
    pipeline, script = make_pipeline()
    fact = ScriptFactLedgerEntry(
        fact_id="fact-rejected",
        kind="event",
        source_revision=script.source_revision,
        value={"summary": "Rejected claim"},
        evidence_status="rejected",
    )
    script.fact_ledger_revisions = [ScriptFactLedgerRevision(
        revision=1,
        source_revision=script.source_revision,
        facts=[fact],
        confirmed_at=10,
    )]
    story_map = valid_story_map()
    story_map["source_revision_id"] = ""
    story_map["fact_ledger_revision"] = 1
    story_map["phases"][0]["events"][0]["source_fact_ids"] = ["fact-rejected"]

    with pytest.raises(ValueError, match="cannot cite rejected facts"):
        pipeline.save_director_profile_draft(
            "film", script.source_revision, 0, {**profile_payload(), "story_map": story_map},
        )


def test_director_profile_cannot_confirm_unsaved_or_stale_drafts():
    pipeline, script = make_pipeline()
    draft = profile_payload()
    pipeline.save_director_profile_draft("film", script.source_revision, 0, draft)

    changed = {**draft, "pacing": "user changed after draft save"}
    with pytest.raises(ValueError, match="unsaved edits"):
        pipeline.apply_director_profile(
            "film", changed, expected_current_revision=0, expected_draft_revision=1,
        )

    pipeline.update_script_text("film", "new source")
    with pytest.raises(ValueError, match="Source revision changed"):
        pipeline.apply_director_profile(
            "film", draft, expected_current_revision=0, expected_draft_revision=1,
        )


def test_director_profile_draft_api_accepts_blank_story_map_source_identity(monkeypatch):
    from src.apps.comic_gen import api
    pipeline, script = make_pipeline()
    monkeypatch.setattr(api, "pipeline", pipeline)
    owner = UserContext("user", "owner", "", "")
    draft = {**profile_payload(), "story_map": valid_story_map()}
    draft["story_map"]["source_revision_id"] = ""
    saved = api.save_director_profile_draft("film", api.DirectorProfileDraftSaveRequest(source_revision=script.source_revision, expected_draft_revision=0, draft=draft), owner)
    assert saved["draft"]["story_map"]["source_revision_id"]


def test_director_profile_draft_api_exposes_save_and_confirm_as_separate_actions(monkeypatch):
    from fastapi import HTTPException
    from src.apps.comic_gen import api

    pipeline, script = make_pipeline()
    monkeypatch.setattr(api, "pipeline", pipeline)
    owner = UserContext("user", "owner", "", "")

    draft = api.save_director_profile_draft(
        "film",
        api.DirectorProfileDraftSaveRequest(
            source_revision=script.source_revision,
            expected_draft_revision=0,
            draft=profile_payload(),
        ),
        owner,
    )
    assert draft["draft_revision"] == 1
    assert draft["source_revision"] == script.source_revision
    assert script.art_direction.director_profile is None

    with pytest.raises(HTTPException) as conflict:
        api.save_director_profile_draft(
            "film",
            api.DirectorProfileDraftSaveRequest(
                source_revision=script.source_revision,
                expected_draft_revision=0,
                draft=profile_payload(),
            ),
            owner,
        )
    assert conflict.value.status_code == 409


def test_legacy_confirmed_profile_uses_real_zero_draft_revision_on_first_load(monkeypatch):
    from src.apps.comic_gen import api

    pipeline, script = make_pipeline()
    pipeline.apply_director_profile("film", profile_payload())
    monkeypatch.setattr(api, "pipeline", pipeline)
    owner = UserContext("user", "owner", "", "")
    state = api.get_director_profile_draft("film", owner)

    assert state["draft"] is not None
    assert state["draft_revision"] == 0
    assert state["source_revision"] == script.source_revision

def test_apply_director_profile_archives_only_changed_confirmations():
    pipeline, script = make_pipeline()
    draft = profile_payload()

    first = pipeline.apply_director_profile("film", draft)
    assert len(first.director_profile_revisions) == 1
    assert first.director_profile_revisions[0].revision == 1
    assert first.director_profile_revisions[0].profile.content_hash == first.art_direction.director_profile.content_hash

    unchanged = pipeline.apply_director_profile("film", draft)
    assert len(unchanged.director_profile_revisions) == 1

    changed_draft = {**draft, "pacing": "更克制，保留等待的停顿"}
    changed = pipeline.apply_director_profile("film", changed_draft)
    assert len(changed.director_profile_revisions) == 2
    assert [item.revision for item in changed.director_profile_revisions] == [1, 2]
    assert changed.director_profile_revisions[-1].profile.pacing == changed_draft["pacing"]


def test_episode_director_profile_preserves_inherited_series_visual_style():
    pipeline, script = make_pipeline()
    script.art_direction = None
    script.series_id = "series"
    pipeline.series_store = {
        "series": Series(
            id="series", title="Film", created_at=1, updated_at=1,
            art_direction=ArtDirection(
                selected_style_id="jp-live-action",
                style_config={"name": "日式真人爱情", "positive_prompt": "restrained"},
            ),
        )
    }

    pipeline.apply_director_profile("film", profile_payload())

    assert script.art_direction.selected_style_id == "jp-live-action"
    assert script.art_direction.style_config["positive_prompt"] == "restrained"
    assert script.art_direction.director_profile.revision == 1


def test_storyboard_requests_receive_confirmed_director_profile_and_revision():
    pipeline, script = make_pipeline()
    payload = profile_payload()
    script.art_direction.director_profile = DirectorProfile(
        **payload, revision=3, content_hash="confirmed-hash", confirmed_at=10,
    )
    pipeline.script_processor.analyze_to_storyboard.return_value = [{"action_summary": "离校"}]

    pipeline.preview_storyboard_analysis("film", script.original_text)

    kwargs = pipeline.script_processor.analyze_to_storyboard.call_args.kwargs
    assert kwargs["director_profile"]["revision"] == 3
    assert kwargs["director_profile"]["content_hash"] == "confirmed-hash"
    assert set(kwargs["director_profile"]) == {
        "revision", "content_hash", "execution_summary", "scene_summaries", "canon_state",
    }
    assert "sample_plan" not in kwargs["director_profile"]


def test_asset_prompt_context_contains_director_profile():
    pipeline, script = make_pipeline()
    script.art_direction.director_profile = DirectorProfile(
        **profile_payload(), revision=2, content_hash="profile-2", confirmed_at=10,
    )

    context = pipeline.director_prompt_context(script)

    assert "中国大学校园与北京" in context
    assert "不引入日本招牌" in context
    assert "Director profile revision: 2" in context
    assert '"execution_summary"' in context
    assert '"timeline"' not in context


def test_version_pinned_fact_ledger_context_filters_by_source_range_and_subject():
    from src.apps.comic_gen.models import ScriptFactLedgerEntry, SourceRange

    pipeline, script = make_pipeline()
    script.original_text = "场景21至44"
    script.art_direction.director_profile = DirectorProfile(
        **profile_payload(), revision=1, content_hash="profile-1", confirmed_at=10,
    )
    facts = [
        ScriptFactLedgerEntry(
            fact_id="shen-fact", kind="character", subject_ids=["shen"],
            source_revision=1, source_ranges=[SourceRange(start=0, end=2)],
            value={"state": "at campus"}, evidence_status="confirmed",
        ),
        ScriptFactLedgerEntry(
            fact_id="zhou-fact", kind="character", subject_ids=["zhou"],
            source_revision=1, source_ranges=[SourceRange(start=5, end=6)],
            value={"state": "leaving"}, evidence_status="confirmed",
        ),
        ScriptFactLedgerEntry(
            fact_id="global-question", kind="uncertainty", subject_ids=[],
            source_revision=1, value={"question": "season unknown"},
            evidence_status="uncertain",
        ),
    ]
    pipeline.apply_fact_ledger("film", 1, 0, facts)

    context = pipeline.director_execution_context(
        script, source_range=(0, 3), subject_ids=["shen"],
    )
    ledger = context["script_fact_ledger"]
    assert ledger["status"] == "current"
    assert {fact["fact_id"] for fact in ledger["facts"]} == {
        "shen-fact", "global-question",
    }

    pipeline.update_script_text("film", "场景25周涵抵达北京")
    stale_context = pipeline.director_execution_context(script)
    assert stale_context["script_fact_ledger"]["status"] == "stale"
    assert stale_context["script_fact_ledger"]["facts"] == []


def test_asset_generation_receives_and_records_confirmed_director_profile():
    from src.apps.comic_gen.models import ScriptFactLedgerEntry, SourceRange

    pipeline, script = make_pipeline()
    script.art_direction.director_profile = DirectorProfile(
        **profile_payload(), revision=2, content_hash="profile-2", confirmed_at=10,
    )
    character = script.characters[0]
    pipeline.asset_generator = Mock()
    pipeline._find_asset_with_source = Mock(return_value=(character, script))
    pipeline._save_after_asset_mutation = Mock()
    pipeline.apply_fact_ledger("film", 1, 0, [ScriptFactLedgerEntry(
        fact_id="shen-fact", kind="character", subject_ids=[character.id],
        source_revision=1, source_ranges=[SourceRange(start=0, end=2)],
        value={"state": "大学时期"}, evidence_status="confirmed",
    )])

    pipeline.generate_asset("film", character.id, "character", generation_type="full_body")

    prompt = pipeline.asset_generator.generate_character.call_args.kwargs["positive_prompt"]
    assert "Director profile revision: 2" in prompt
    assert "中国大学校园与北京" in prompt
    assert character.director_profile_revision == 2
    assert character.director_profile_hash == "profile-2"
    assert character.director_review_required is False
    assert character.generation_lineage.status == "pinned"
    assert character.generation_lineage.source_revision == 1
    assert character.generation_lineage.director_profile_revision == 2
    assert character.generation_lineage.fact_ledger_revision == 1
    assert character.generation_lineage.fact_ids == ["shen-fact"]
    assert character.generation_lineage.source_ranges == [SourceRange(start=0, end=2)]


def test_director_source_split_preserves_exact_ranges_and_prefers_sentence_boundaries():
    text = "".join(
        f"第{i}段：人物在地点{i}推进冲突。接着留下悬念{i}！\n"
        for i in range(1200)
    )
    chunks = split_director_source(
        text,
        direct_max_chars=1000,
        target_chars=1000,
        max_chars=1200,
    )

    assert len(chunks) > 1
    assert "".join(chunk["text"] for chunk in chunks) == text
    assert chunks[0]["char_start"] == 0
    assert chunks[-1]["char_end"] == len(text)
    assert all(chunk["char_end"] - chunk["char_start"] <= 1200 for chunk in chunks)
    assert all(
        chunk["source_ref"] == (
            f"source:chars-{chunk['char_start']}-{chunk['char_end']}"
        )
        for chunk in chunks
    )
    # The fixture has a sentence boundary well before every hard limit; a
    # chunk therefore ends after punctuation/newline rather than mid-token.
    assert all(
        text[chunk["char_end"] - 1] in "。！？!?；;\n\r”"
        for chunk in chunks[:-1]
    )


def test_short_director_source_stays_on_single_call_path():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps(profile_payload(), ensure_ascii=False)
    source = "短剧本：开头、冲突、结尾。"

    processor.analyze_director_profile(source, {"characters": []}, {})

    assert processor.llm.chat.call_count == 1
    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert source in prompt
    assert "source_digest" not in prompt
    assert '<stage_preset name="director-interpretation">' in prompt
    assert "原文事实、导演解释、用户要求和未决问题必须分开" in prompt


def test_director_analysis_with_audit_preserves_raw_response_and_direct_source_metadata():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    raw = json.dumps(profile_payload(), ensure_ascii=False)
    processor.llm.chat.return_value = raw

    result = processor.analyze_director_profile_with_audit(
        "短剧本。", {"characters": []}, {}
    )

    assert result["profile"]["setting"]
    assert result["source_audit"]["source_mode"] == "direct"
    assert result["source_audit"]["source_char_count"] == 4
    assert result["source_audit"]["raw_response"] == raw
    assert result["source_audit"]["raw_response_sha256"]
    assert result["source_audit"]["normalization_status"] == "pending"


def test_director_analysis_with_audit_records_digest_and_map_notes():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True, provider="mock")
    processor.llm._get_default_model.return_value = "mock-director"
    source = "第1场：人物进入教室。" * 900

    def chat_side_effect(**kwargs):
        prompt = kwargs["messages"][0]["content"]
        if "<source_chunk" in prompt:
            return json.dumps({"summary": "场景摘要", "facts": ["人物进入"], "open_threads": []}, ensure_ascii=False)
        return json.dumps(profile_payload(), ensure_ascii=False)

    processor.llm.chat.side_effect = chat_side_effect
    result = processor.analyze_director_profile_with_audit(source, {"characters": []}, {})

    audit = result["source_audit"]
    assert audit["source_mode"] == "map_reduce"
    assert audit["chunk_count"] >= 1
    assert audit["mapped_notes"]
    assert audit["digest_sha256"]
    assert audit["raw_response"]


def test_director_source_mode_can_force_direct_for_ab_comparison():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps(profile_payload(), ensure_ascii=False)
    source = "长文本。" * 2000

    result = processor.analyze_director_profile_with_audit(
        source, {"characters": []}, {}, source_mode="direct"
    )

    assert result["source_audit"]["source_mode"] == "direct"
    assert result["source_audit"]["source_char_count"] == len(source)
    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert source in prompt
    assert "source_digest" not in prompt


def test_director_source_mode_can_force_map_reduce_for_ab_comparison():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True, provider="mock")
    processor.llm._get_default_model.return_value = "mock-director"

    def chat_side_effect(**kwargs):
        prompt = kwargs["messages"][0]["content"]
        if "<source_chunk" in prompt:
            return json.dumps({"summary": "强制摘要", "facts": [], "open_threads": []}, ensure_ascii=False)
        return json.dumps(profile_payload(), ensure_ascii=False)

    processor.llm.chat.side_effect = chat_side_effect
    result = processor.analyze_director_profile_with_audit(
        "短文本。", {"characters": []}, {}, source_mode="map_reduce"
    )

    assert result["source_audit"]["source_mode"] == "map_reduce"
    assert result["source_audit"]["chunk_count"] == 1


def test_director_analysis_reports_empty_model_response_instead_of_attribute_error():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = None
    with pytest.raises(RuntimeError, match="未返回内容"):
        processor.analyze_director_profile("短剧本。", {"characters": []}, {})


def test_director_refinement_reports_empty_model_response_instead_of_attribute_error():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = None
    with pytest.raises(RuntimeError, match="未返回内容"):
        processor.refine_director_profile("短剧本。", {"characters": []}, {}, profile_payload(), ["保留原意"])


def test_long_director_source_uses_source_digest_and_reuses_map_cache():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True, provider="mock")
    processor.llm._get_default_model.return_value = "mock-director"
    source = "".join(
        f"第{i}段：令狐冲在地点{i % 7}面对新的选择。余波仍未平息。\n"
        for i in range(1200)
    )
    assert len(source) > DIRECTOR_SOURCE_DIRECT_MAX_CHARS
    chunks = split_director_source(source)
    calls = []

    def chat_side_effect(**kwargs):
        prompt = kwargs["messages"][0]["content"]
        calls.append(prompt)
        if "<source_chunk" in prompt:
            return json.dumps({
                "summary": "本片段推进人物关系并留下局部悬念。",
                "continuity_in": "人物带着上一段冲突进入",
                "continuity_out": "新的选择改变关系状态",
                "facts": ["人物关系发生变化"],
                "open_threads": ["选择的后果尚未揭示"],
            }, ensure_ascii=False)
        return json.dumps(profile_payload(), ensure_ascii=False)

    processor.llm.chat.side_effect = chat_side_effect
    processor.analyze_director_profile(source, {"characters": []}, {})

    assert len(calls) == len(chunks) + 1
    final_prompt = calls[-1]
    assert "<source_digest>" in final_prompt
    assert "chunk_summaries" in final_prompt
    assert "head_anchor" in final_prompt and "tail_anchor" in final_prompt
    assert len(final_prompt) < 70000
    # A distinctive middle marker is present in a map request but not copied
    # verbatim into the final Director request.
    middle_marker = "第600段：令狐冲"
    assert any(middle_marker in prompt for prompt in calls[:-1])
    assert middle_marker not in final_prompt

    map_call_count = len(calls) - 1
    processor.refine_director_profile(
        source,
        {"characters": []},
        {},
        profile_payload(),
        ["强化首尾框架的样片节奏"],
    )
    assert len(calls) == map_call_count + 2


def test_long_director_source_maps_chunks_concurrently_but_keeps_digest_order():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True, provider="mock")
    processor.llm._get_default_model.return_value = "mock-director"
    source = "".join(f"第{i}段：连续性测试。\n" for i in range(2400))
    active = 0
    peak = 0
    lock = threading.Lock()

    def chat_side_effect(**kwargs):
        nonlocal active, peak
        prompt = kwargs["messages"][0]["content"]
        if "<source_chunk" not in prompt:
            return json.dumps(profile_payload(), ensure_ascii=False)
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.01)
        marker = prompt.split("<source_chunk", 1)[1].split(">", 1)[0]
        with lock:
            active -= 1
        return json.dumps({
            "summary": marker,
            "continuity_in": "",
            "continuity_out": marker,
        }, ensure_ascii=False)

    processor.llm.chat.side_effect = chat_side_effect
    digest = processor._director_source_digest(source)
    payload = json.loads(digest[len("<source_digest>"):-len("</source_digest>")])
    refs = [item["source_ref"] for item in payload["chunk_summaries"]]
    assert peak > 1
    assert refs == [chunk["source_ref"] for chunk in split_director_source(source)]


def test_long_director_source_propagates_request_context_to_map_workers(monkeypatch):
    from contextvars import ContextVar

    request_owner = ContextVar("test_director_owner", default=None)
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True, provider="mock")
    source = "第1场：人物进入教室。" * 500
    seen = []

    def chat_side_effect(**kwargs):
        seen.append(request_owner.get())
        prompt = kwargs["messages"][0]["content"]
        if "<source_chunk" in prompt:
            return json.dumps({"summary": "摘要", "continuity_in": "", "continuity_out": "", "facts": [], "open_threads": []})
        return json.dumps(profile_payload(), ensure_ascii=False)

    processor.llm.chat.side_effect = chat_side_effect
    token = request_owner.set("owner-a")
    try:
        processor._director_source_digest(source)
    finally:
        request_owner.reset(token)
    assert seen and all(value == "owner-a" for value in seen)


def test_long_source_map_response_keeps_server_owned_source_ranges():
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    source = ("开场人物进入房间。" * 2000) + "结尾回到现实。"
    chunks = split_director_source(source)
    processor.llm.chat.return_value = json.dumps({
        "source_ref": "model-invented-ref",
        "summary": "有来源的片段摘要。",
    }, ensure_ascii=False)

    digest = processor._director_source_digest(source)

    assert "model-invented-ref" not in digest
    assert all(
        f'"source_ref":"source:chars-{chunk["char_start"]}-{chunk["char_end"]}"'
        in digest
        for chunk in chunks
    )


def test_director_jobs_are_durable_owner_scoped_and_non_mutating(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from src.apps.comic_gen import api
    from src.apps.comic_gen.extraction_jobs import ExtractionJobs

    source = Script(id="film", title="Film", original_text="source", created_at=1, updated_at=1,
                    owner_profile_id="owner")
    captured = {}
    pipeline = SimpleNamespace(
        scripts={"film": source},
        get_script=lambda project: source,
        effective_director_overview_template=lambda script: DirectorOverviewTemplate(fields=[DirectorOverviewField(key="time_period", label="时代", purpose="原文时代")]),
        script_processor=SimpleNamespace(llm=SimpleNamespace(
            provider="openai", _get_default_model=lambda: "test",
        )),
        director_analysis_context=lambda project: (source, {"characters": []}, {"name": "style"}),
        preview_director_profile=lambda project, overview_template: profile_payload(),
        refine_director_profile=lambda project, draft, instructions, overview_template: (
            captured.update(draft=draft, instructions=instructions) or profile_payload()
        ),
    )
    owner = UserContext("user", "owner", "", "")
    other = UserContext("other", "other", "", "")

    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / "director-jobs.db", executor=executor)
        monkeypatch.setattr(api, "pipeline", pipeline)
        monkeypatch.setattr(api, "extraction_jobs", jobs)
        job = api.start_director_profile_analysis("film", owner)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            done = jobs.get("owner", "film", job["id"])
            if done["status"] != "running":
                break
            time.sleep(0.01)
        assert done["result"]["profile"]["setting"]["geography"] == "中国大学校园与北京"
        assert source.art_direction is None
        try:
            api.director_profile_status("film", job["id"], other)
            raise AssertionError("other owner unexpectedly read director job")
        except HTTPException as exc:
            assert exc.status_code == 404

        revision = api.start_director_profile_refinement(
            "film",
            api.DirectorProfileRefineRequest(
                draft=profile_payload(), instructions=["保留中国背景", "强调未接来电"],
            ),
            owner,
        )
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            revised = jobs.get("owner", "film", revision["id"])
            if revised["status"] != "running":
                break
            time.sleep(0.01)

    assert revised["status"] == "completed"
    assert captured["instructions"] == ["保留中国背景", "强调未接来电"]


def test_director_refinement_accepts_structured_text_fields_and_returns_normalized_result(tmp_path, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.comic_gen.extraction_jobs import ExtractionJobs

    source = Script(id="film", title="Film", original_text="source", created_at=1, updated_at=1,
                    owner_profile_id="owner")
    pipeline = SimpleNamespace(
        scripts={"film": source},
        get_script=lambda project: source,
        effective_director_overview_template=lambda script: DirectorOverviewTemplate(fields=[DirectorOverviewField(key="time_period", label="时代", purpose="原文时代")]),
        script_processor=SimpleNamespace(llm=SimpleNamespace(
            provider="openai", _get_default_model=lambda: "test",
        )),
        director_analysis_context=lambda project: (source, {"characters": []}, {"name": "style"}),
        refine_director_profile=lambda project, draft, instructions, overview_template: normalize_director_profile_draft(
            structured_profile_payload()
        ),
    )
    owner = UserContext("user", "owner", "", "")

    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / "director-jobs.sqlite3", executor=executor)
        monkeypatch.setattr(api, "pipeline", pipeline)
        monkeypatch.setattr(api, "extraction_jobs", jobs)
        revision = api.start_director_profile_refinement(
            "film",
            api.DirectorProfileRefineRequest(
                draft=structured_profile_payload(), instructions=["增加分开后的陌路人的感觉"],
            ),
            owner,
        )
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            revised = jobs.get("owner", "film", revision["id"])
            if revised["status"] != "running":
                break
            time.sleep(0.01)

    assert revised["status"] == "completed"
    assert isinstance(revised["result"]["profile"]["emotional_arc"], str)
    assert "陌生人" in revised["result"]["profile"]["emotional_arc"]


def test_director_refinement_rejects_invalid_draft_with_422(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from src.apps.comic_gen import api
    from src.apps.comic_gen.extraction_jobs import ExtractionJobs

    source = Script(id="film", title="Film", original_text="source", created_at=1, updated_at=1,
                    owner_profile_id="owner")
    pipeline = SimpleNamespace(
        scripts={"film": source},
        script_processor=SimpleNamespace(llm=SimpleNamespace(
            provider="openai", _get_default_model=lambda: "test",
        )),
        director_analysis_context=lambda project: (source, {"characters": []}, {"name": "style"}),
    )
    owner = UserContext("user", "owner", "", "")

    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / "director-jobs.sqlite3", executor=executor)
        monkeypatch.setattr(api, "pipeline", pipeline)
        monkeypatch.setattr(api, "extraction_jobs", jobs)
        with pytest.raises(HTTPException) as raised:
            api.start_director_profile_refinement(
                "film",
                api.DirectorProfileRefineRequest(
                    draft={**profile_payload(), "setting": "not an object"}, instructions=["保留内容"],
                ),
                owner,
            )

    assert raised.value.status_code == 422
