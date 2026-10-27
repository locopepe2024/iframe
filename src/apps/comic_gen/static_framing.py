"""Field-scoped contract for a storyboard shot's static opening frame."""

from typing import Any, Dict, List

from pydantic import BaseModel, ConfigDict, Field, model_validator


FIELDS = {"shot_size", "camera_angle", "composition"}
LIMITS = {"shot_size": 64, "camera_angle": 120, "composition": 1200}


class StaticFramingProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: Dict[str, str] = Field(min_length=1, max_length=3)
    rationale: Dict[str, str]
    source_refs: Dict[str, List[str]]
    uncertainties: List[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_fields(self):
        keys = set(self.fields)
        if keys - FIELDS or set(self.rationale) != keys or set(self.source_refs) != keys:
            raise ValueError("静态起幅结果只能为已提出字段提供理由与来源")
        for key, value in self.fields.items():
            if not value.strip() or len(value) > LIMITS[key]:
                raise ValueError("静态起幅字段为空或过长")
            if not self.rationale[key].strip() or len(self.rationale[key]) > 500:
                raise ValueError("静态起幅理由无效")
            sources = self.source_refs[key]
            if not sources or len(sources) > 8 or any(not item.strip() or len(item) > 160 for item in sources):
                raise ValueError("静态起幅来源无效")
        if any(not item.strip() or len(item) > 500 for item in self.uncertainties):
            raise ValueError("待确认项无效")
        return self


def validate_static_framing_payload(value: Any) -> StaticFramingProposal:
    if not isinstance(value, dict):
        raise ValueError("静态起幅结果必须是对象")
    return StaticFramingProposal.model_validate(value)
