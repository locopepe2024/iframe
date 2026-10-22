import pytest

from src.apps.comic_gen.micro_expression import (
    opening_static_state,
    validate_micro_expression_payload,
    video_timing_description,
)


def payload(**overrides):
    candidate = {
        "character_id": "hero",
        "emotion_intent": "克制地意识到危险",
        "visibility": "close",
        "timing": [
            {"phase": "trigger", "relative_start": 0, "relative_end": 0.2, "visible_change": "视线短暂停住"},
            {"phase": "change", "relative_start": 0.2, "relative_end": 0.5, "visible_change": "眉心轻微收紧"},
            {"phase": "hold", "relative_start": 0.5, "relative_end": 0.8, "visible_change": "保持克制"},
            {"phase": "release", "relative_start": 0.8, "relative_end": 1, "visible_change": "视线恢复正前方"},
        ],
        "facial_channels": {"brows": "轻微收紧", "eyes_gaze": "短暂停住"},
        "body_invariant": "服装和站姿不变",
        "uncertainties": [],
        "source_refs": ["shot-1"],
    }
    candidate.update(overrides)
    return {"candidates": [candidate]}


def test_micro_expression_accepts_ordered_relative_timing():
    result = validate_micro_expression_payload(payload(), duration_seconds=6)
    assert opening_static_state(result[0]) == "视线短暂停住"
    assert "change(0.20-0.50)" in video_timing_description(result[0])


@pytest.mark.parametrize("bad", [
    {"phase": "release", "relative_start": 0.2, "relative_end": 0.4, "visible_change": "x"},
    {"phase": "change", "relative_start": 0.2, "relative_end": 0.1, "visible_change": "x"},
])
def test_micro_expression_rejects_invalid_phase_order_or_range(bad):
    value = payload()
    value["candidates"][0]["timing"][1] = bad
    with pytest.raises(ValueError):
        validate_micro_expression_payload(value)


def test_micro_expression_rejects_unrelated_prompt_fields():
    value = payload()
    value["candidates"][0]["prompt"] = "重做整个场景"
    with pytest.raises(ValueError):
        validate_micro_expression_payload(value)


def test_micro_expression_rejects_unknown_facial_channel():
    value = payload()
    value["candidates"][0]["facial_channels"]["lighting"] = "red"
    with pytest.raises(ValueError):
        validate_micro_expression_payload(value)
