"""Strict output contract for model-independent, shot-scoped camera movement."""

from typing import Any, List

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import CameraMovementData, CameraMovementType, CameraSpeed


class MovementProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    camera_movement_structured: CameraMovementData
    rationale: str = Field(min_length=1, max_length=500)
    source_refs: List[str] = Field(min_length=1, max_length=8)
    uncertainties: List[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_movement(self):
        movement = self.camera_movement_structured
        allowed = {item.value for item in CameraMovementType}
        if movement.primary not in allowed or (movement.secondary and movement.secondary not in allowed):
            raise ValueError("未知运镜类型")
        if movement.speed not in {item.value for item in CameraSpeed}:
            raise ValueError("未知运镜速度")
        if movement.primary == "static" and movement.secondary:
            raise ValueError("固定机位不可叠加副运镜")
        if movement.secondary == movement.primary:
            raise ValueError("副运镜不得重复主运镜")
        if not all(item.strip() and len(item) <= 160 for item in self.source_refs):
            raise ValueError("来源引用无效")
        if not all(item.strip() and len(item) <= 500 for item in self.uncertainties):
            raise ValueError("待确认项无效")
        return self


def validate_movement_payload(value: Any) -> MovementProposal:
    if not isinstance(value, dict):
        raise ValueError("运镜结果必须是对象")
    movement = value.get("camera_movement_structured")
    if not isinstance(movement, dict) or set(movement) - {"primary", "secondary", "speed", "description"}:
        raise ValueError("运镜字段包含未知内容")
    return MovementProposal.model_validate(value)
