"""Validation and rendering helpers for the isolated micro-expression stage."""

from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, ConfigDict, Field, model_validator


PHASES = ("trigger", "change", "hold", "release")
CHANNELS = ("brows", "eyes_gaze", "eyelids", "mouth", "jaw")


class MicroExpressionTiming(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phase: str
    relative_start: float = Field(ge=0, le=1)
    relative_end: float = Field(ge=0, le=1)
    visible_change: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_range(self):
        if self.phase not in PHASES:
            raise ValueError("phase 必须是 trigger、change、hold 或 release")
        if self.relative_end <= self.relative_start:
            raise ValueError("relative_end 必须大于 relative_start")
        return self


class MicroExpressionCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    character_id: str = Field(min_length=1, max_length=160)
    emotion_intent: str = Field(min_length=1, max_length=500)
    visibility: str
    timing: List[MicroExpressionTiming] = Field(min_length=1, max_length=4)
    facial_channels: Dict[str, str] = Field(default_factory=dict)
    body_invariant: str = Field(default="", max_length=1000)
    uncertainties: List[str] = Field(default_factory=list, max_length=12)
    source_refs: List[str] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def validate_shape(self):
        if self.visibility not in {"close", "medium", "wide", "occluded"}:
            raise ValueError("visibility 必须是 close、medium、wide 或 occluded")
        if set(self.facial_channels) - set(CHANNELS):
            raise ValueError("facial_channels 含有未允许的通道")
        phases = [item.phase for item in self.timing]
        if phases != list(PHASES):
            raise ValueError("timing 阶段必须完整且按 trigger、change、hold、release 顺序")
        if self.timing[0].relative_start != 0:
            raise ValueError("trigger 必须从镜头起点开始")
        if any(next_item.relative_start < item.relative_end for item, next_item in zip(self.timing, self.timing[1:])):
            raise ValueError("timing 阶段不得重叠")
        return self


def validate_micro_expression_payload(payload: Any, *, duration_seconds: float | None = None) -> List[MicroExpressionCandidate]:
    """Validate a model result without accepting prompt text or unrelated fields."""
    if not isinstance(payload, dict) or set(payload) - {"candidates"}:
        raise ValueError("微表情结果只能包含 candidates")
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("微表情结果必须包含至少一个 candidate")
    result = [MicroExpressionCandidate.model_validate(item) for item in candidates]
    if duration_seconds is not None and duration_seconds <= 0:
        raise ValueError("镜头时长必须大于 0")
    return result


def opening_static_state(candidate: MicroExpressionCandidate) -> str:
    """Return only the trigger state for a first-frame prompt."""
    item = next((entry for entry in candidate.timing if entry.phase == "trigger"), None)
    if item is None:
        return ""
    return item.visible_change


def video_timing_description(candidate: MicroExpressionCandidate) -> str:
    """Render the full ordered timing for video prompt compilation."""
    return "；".join(
        f"{item.phase}({item.relative_start:.2f}-{item.relative_end:.2f})：{item.visible_change}"
        for item in candidate.timing
    )
