import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import (
    ArtDirection,
    Character,
    DirectorProfile,
    Script,
    Series,
    normalize_director_profile_draft,
)
from src.apps.identity import UserContext


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


def make_pipeline():
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
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


def test_director_refinement_prompt_contains_source_entities_style_draft_and_history():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps(profile_payload(), ensure_ascii=False)

    result = processor.refine_director_profile(
        "场景21 周涵离校",
        {"characters": [{"name": "沈夏"}]},
        {"name": "日式真人爱情", "positive_prompt": "restrained"},
        profile_payload(),
        ["故事仍发生在中国", "突出未接来电"],
    )

    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "场景21 周涵离校" in prompt
    assert '"name": "沈夏"' in prompt
    assert "日式真人爱情" in prompt
    assert "距离→压力→沟通失效→关系消耗" in prompt
    assert "1. 故事仍发生在中国" in prompt and "2. 突出未接来电" in prompt
    assert result["setting"]["geography"] == "中国大学校园与北京"


def test_director_preview_normalizes_structured_text_fields_without_losing_content():
    pipeline, _ = make_pipeline()
    pipeline.script_processor.analyze_director_profile.return_value = structured_profile_payload()

    result = pipeline.preview_director_profile("film")

    assert isinstance(result["emotional_arc"], str)
    assert "熟悉的陌生人" in result["emotional_arc"]
    assert "冷灰" in result["visual_language"]
    DirectorProfile(**result)


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


def test_asset_prompt_context_contains_director_profile():
    pipeline, script = make_pipeline()
    script.art_direction.director_profile = DirectorProfile(
        **profile_payload(), revision=2, content_hash="profile-2", confirmed_at=10,
    )

    context = pipeline.director_prompt_context(script)

    assert "中国大学校园与北京" in context
    assert "不引入日本招牌" in context
    assert "Director profile revision: 2" in context


def test_asset_generation_receives_and_records_confirmed_director_profile():
    pipeline, script = make_pipeline()
    script.art_direction.director_profile = DirectorProfile(
        **profile_payload(), revision=2, content_hash="profile-2", confirmed_at=10,
    )
    character = script.characters[0]
    pipeline.asset_generator = Mock()
    pipeline._find_asset_with_source = Mock(return_value=(character, script))
    pipeline._save_after_asset_mutation = Mock()

    pipeline.generate_asset("film", character.id, "character", generation_type="full_body")

    prompt = pipeline.asset_generator.generate_character.call_args.kwargs["positive_prompt"]
    assert "Director profile revision: 2" in prompt
    assert "中国大学校园与北京" in prompt
    assert character.director_profile_revision == 2
    assert character.director_profile_hash == "profile-2"
    assert character.director_review_required is False


def test_director_jobs_are_durable_owner_scoped_and_non_mutating(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from src.apps.comic_gen import api
    from src.apps.comic_gen.extraction_jobs import ExtractionJobs

    source = Script(id="film", title="Film", original_text="source", created_at=1, updated_at=1,
                    owner_profile_id="owner")
    captured = {}
    pipeline = SimpleNamespace(
        scripts={"film": source},
        script_processor=SimpleNamespace(llm=SimpleNamespace(
            provider="openai", _get_default_model=lambda: "test",
        )),
        director_analysis_context=lambda project: (source, {"characters": []}, {"name": "style"}),
        preview_director_profile=lambda project: profile_payload(),
        refine_director_profile=lambda project, draft, instructions: (
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
        script_processor=SimpleNamespace(llm=SimpleNamespace(
            provider="openai", _get_default_model=lambda: "test",
        )),
        director_analysis_context=lambda project: (source, {"characters": []}, {"name": "style"}),
        refine_director_profile=lambda project, draft, instructions: normalize_director_profile_draft(
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
