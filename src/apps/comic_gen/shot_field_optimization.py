"""Validated, model-neutral proposals for existing shot controls."""

from typing import Any, Dict, List

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .camera_movement import validate_movement_payload


SHOT_FIELD_KEYS = frozenset({
    "duration", "shot_size", "camera_angle", "camera_movement_structured",
    "transition_hint", "style_prompt_override", "lighting_override",
})


class ShotFieldProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: Dict[str, Any] = Field(max_length=7)
    rationale: Dict[str, str]
    source_refs: Dict[str, List[str]]
    uncertainties: List[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_fields(self):
        keys = set(self.fields)
        if keys - SHOT_FIELD_KEYS or set(self.rationale) != keys or set(self.source_refs) != keys:
            raise ValueError("Shot proposal fields and evidence must match")
        for key, value in self.fields.items():
            if key == "duration":
                if type(value) is not int or not 1 <= value <= 60:
                    raise ValueError("Invalid shot duration")
            elif key == "camera_movement_structured":
                validate_movement_payload({
                    "camera_movement_structured": value,
                    "rationale": self.rationale[key],
                    "source_refs": self.source_refs[key],
                    "uncertainties": [],
                })
            elif not isinstance(value, str) or not value.strip() or len(value) > 500:
                raise ValueError("Invalid shot field value")
            if not isinstance(self.rationale[key], str) or not self.rationale[key].strip() or len(self.rationale[key]) > 500:
                raise ValueError("Missing shot field rationale")
            refs = self.source_refs[key]
            if not refs or len(refs) > 8 or any(not isinstance(ref, str) or not ref.strip() or len(ref) > 80 for ref in refs):
                raise ValueError("Missing shot field source")
        if any(not isinstance(item, str) or not item.strip() or len(item) > 500 for item in self.uncertainties):
            raise ValueError("Invalid uncertainty")
        return self


def validate_shot_field_payload(value: Any) -> ShotFieldProposal:
    if not isinstance(value, dict):
        raise ValueError("Shot field proposal must be an object")
    return ShotFieldProposal.model_validate(value)
