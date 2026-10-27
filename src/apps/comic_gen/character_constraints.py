"""Authored character constraints shared by AI requests and saved revisions."""
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ConstraintText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=500)]


class CharacterConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    must_keep: list[ConstraintText] = Field(default_factory=list, max_length=20)
    negative_prompt: list[ConstraintText] = Field(default_factory=list, max_length=20)
