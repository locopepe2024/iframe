import json
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import EpisodeVisualContext, Script, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline


def fixture(snapshot=None, shot_id="shot-1"):
    frame = StoryboardFrame(id="frame", shot_id=shot_id, director_shot_context=snapshot,
                            action_description="动作", scene_id="scene")
    script = Script(id="project", title="Test", original_text="source", created_at=1,
                    updated_at=1, frames=[frame])
    return script, frame


def payload(script, frame):
    prompt = ComicGenPipeline._episode_shot_context_prompt(script, frame)
    raw = prompt[prompt.index("{"):]
    assert len(raw) <= 6000
    return json.loads(raw)


def test_long_snapshot_remains_valid_json_and_preserves_identity():
    script, frame = fixture({
        "shot": {"visual_intent": '卧室\\\"\n' * 6000, "shot_id": "shot-1",
                 "performance_action": "走进卧室" * 6000},
        "scene": {"location": "卧室"},
        "shooting_plan_revision": 7, "shooting_plan_hash": "original-plan",
    })
    result = payload(script, frame)
    assert result["shot"]["shot_id"] == "shot-1"
    assert result["shooting_plan_hash"] == "original-plan"
    assert result["shooting_plan_revision"] == 7


def episode_context():
    return EpisodeVisualContext(
        source_revision=3, source_revision_id="source-3", director_profile_revision=2,
        shooting_plan_revision=4, shooting_plan_hash="new-plan",
        scenes=[{"scene_id": "plan-scene", "place_continuity_id": "roof",
                 "time_continuity_id": "night", "location": "天台"}],
        shots=[{"shot_id": "shot-1", "scene_id": "plan-scene", "beat_id": "beat-1",
                "visual_intent": "当前动作"},
               {"shot_id": "shot-2", "scene_id": "plan-scene", "beat_id": "beat-2",
                "visual_intent": "OTHER_SHOT_SECRET"}],
        lighting_baselines=[{"place_continuity_id": "roof", "time_continuity_id": "night",
                             "lighting": {"key_source": "月光"}}],
    )


def test_exact_episode_lookup_with_provenance_and_matching_baseline():
    script, frame = fixture()
    script.episode_visual_context = episode_context()
    result = payload(script, frame)
    assert result["shot"]["shot_id"] == "shot-1"
    assert result["source_revision"] == 3
    assert result["source_revision_id"] == "source-3"
    assert result["lighting_baseline"]["lighting"]["key_source"] == "月光"
    assert result["projection"]["origin"] == "episode_visual_context"
    assert "OTHER_SHOT_SECRET" not in json.dumps(result)
    frame.shot_id = "missing"
    assert ComicGenPipeline._episode_shot_context_prompt(script, frame) == ""


def test_snapshot_keeps_its_own_provenance_without_current_version_inference():
    script, frame = fixture({"shot": {"shot_id": "shot-1", "visual_intent": "旧快照"},
                             "shooting_plan_revision": 1, "shooting_plan_hash": "old-plan"})
    script.episode_visual_context = episode_context()
    result = payload(script, frame)
    assert result["shooting_plan_hash"] == "old-plan"
    assert result["shooting_plan_revision"] == 1
    assert result["source_revision"] is None
    assert result["source_revision_id"] is None
    assert result["projection"]["origin"] == "frame_snapshot"
    assert result["projection"]["binding_status"] == "matched"


def test_legacy_missing_shot_identity_is_explicit_and_not_invented():
    script, frame = fixture({"shot": {"visual_intent": "旧快照"}})
    result = payload(script, frame)
    assert "shot_id" not in result["shot"]
    assert result["projection"]["frame_shot_id"] == "shot-1"
    assert result["projection"]["binding_status"] == "legacy_unverified"


@pytest.mark.parametrize("snapshot", [
    {"shot": {"shot_id": "shot-2", "visual_intent": "OTHER_SHOT_SECRET"}},
    {"shot": {"shot_id": "shot-1", "scene_id": "a"}, "scene": {"scene_id": "b"}},
    {"shot": {"shot_id": "x" * 241}},
    {"shot": {"shot_id": {"invalid": "identity"}}},
    {"shot": {"shot_id": "shot-1"}, "shooting_plan_hash": "x" * 241},
    {"shot": {"shot_id": "shot-1"}, "shooting_plan_revision": True},
    {},
])
def test_invalid_snapshot_is_suppressed_without_fallback_to_new_plan(snapshot):
    script, frame = fixture(snapshot)
    script.episode_visual_context = episode_context()
    assert ComicGenPipeline._episode_shot_context_prompt(script, frame) == ""


@pytest.mark.parametrize("place,time,include", [
    ("roof", "night", True), ("bedroom", "night", False), ("roof", "day", False),
    (None, "night", False),
])
def test_snapshot_baseline_requires_exact_place_and_time(place, time, include):
    script, frame = fixture({
        "scene": {"place_continuity_id": place, "time_continuity_id": time},
        "shot": {"shot_id": "shot-1"},
        "lighting_baseline": {"place_continuity_id": "roof", "time_continuity_id": "night",
                              "lighting": {"key_source": "月光"}},
    })
    assert ("lighting_baseline" in payload(script, frame)) is include


def test_budget_handles_escaped_dense_input_and_deterministic_allowlist():
    noise = '\\"\n\t卧室' * 5000
    script, frame = fixture({
        "scene": {key: noise for key in ("location", "atmosphere", "continuity_in", "continuity_out")},
        "shot": {"shot_id": "shot-1", "visual_intent": noise, "director_effect": noise,
                 "performance_action": noise, "action_physics": noise,
                 "dialogue": [{"speaker": noise, "line": noise, "unknown": "EXCLUDED"}] * 20,
                 "lighting": {"key_source": noise, "practical_sources": [noise] * 30,
                              "private": "EXCLUDED"}, "extra": "EXCLUDED"},
        "private": {"nested": "EXCLUDED"},
    })
    first = ComicGenPipeline._episode_shot_context_prompt(script, frame)
    assert first == ComicGenPipeline._episode_shot_context_prompt(script, frame)
    result = payload(script, frame)
    assert result["projection"]["shortened"] is True
    assert len(result["shot"]["dialogue"]) == 8
    assert "EXCLUDED" not in first
    assert result["shot"]["shot_id"] == "shot-1"


def test_fixed_identity_over_budget_is_suppressed_instead_of_truncated():
    script, frame = fixture({"shot": {"shot_id": "shot-1", **{
        key: ["x" * 240] * 8 for key in
        ("character_ids", "person_ids", "prop_ids", "source_chunk_refs")
    }}})
    assert ComicGenPipeline._episode_shot_context_prompt(script, frame) == ""


def test_refinement_llm_receives_bounded_current_shot_context():
    script, frame = fixture({"shot": {"shot_id": "shot-1", "visual_intent": '卧室\\\"' * 6000},
                             "shooting_plan_hash": "old-plan"})
    script.episode_visual_context = episode_context()
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.resolve_episode_assets = lambda _: {"characters": [], "scenes": [], "props": []}
    pipeline.script_processor = Mock()
    pipeline.script_processor.refine_frame_to_rich.return_value = None
    assert pipeline.refine_frame(script.id, frame.id) is frame
    prompt = pipeline.script_processor.refine_frame_to_rich.call_args.kwargs["director_context"]
    raw = prompt[prompt.index("{"):]
    assert len(raw) <= 6000
    result = json.loads(raw)
    assert result["shooting_plan_hash"] == "old-plan"
    assert result["shot"]["shot_id"] == "shot-1"
    assert "OTHER_SHOT_SECRET" not in prompt
