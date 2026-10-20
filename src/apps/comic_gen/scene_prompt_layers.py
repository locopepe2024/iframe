"""Opt-in static scene settings; no camera-brand or aesthetic defaults."""
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


class SceneLayerAngles(BaseModel):
    model_config = ConfigDict(extra="forbid")
    azimuth: int = Field(ge=-180, le=180, strict=True)
    elevation: int = Field(ge=-90, le=90, strict=True)


class SceneLightingLayer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(default="", max_length=500, strict=True)
    direction: str = Field(default="", max_length=500, strict=True)
    quality: str = Field(default="", max_length=500, strict=True)
    fill: str = Field(default="", max_length=500, strict=True)
    contrast: str = Field(default="", max_length=500, strict=True)
    shadow: str = Field(default="", max_length=500, strict=True)
    rim: str = Field(default="", max_length=500, strict=True)
    mood: str = Field(default="", max_length=500, strict=True)
    air: str = Field(default="", max_length=500, strict=True)
    color: str = Field(default="", max_length=500, strict=True)
    angles: Optional[SceneLayerAngles] = None

    @model_validator(mode="after")
    def one_direction(self):
        if self.angles is not None and self.direction.strip():
            raise ValueError("Select a named direction or angles, not both")
        return self


class SceneFocusPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: str = Field(default="", max_length=500, strict=True)
    x: Optional[int] = Field(default=None, ge=0, le=100, strict=True)
    y: Optional[int] = Field(default=None, ge=0, le=100, strict=True)
    radius: Optional[int] = Field(default=None, ge=6, le=42, strict=True)

    @model_validator(mode="after")
    def complete_focus(self):
        if (self.x is None) != (self.y is None):
            raise ValueError("Scene focus coordinates must include both x and y")
        if self.radius is not None and self.x is None:
            raise ValueError("Scene focus radius requires image coordinates")
        if not self.target.strip() and self.x is None:
            raise ValueError("Scene focus requires a target or image coordinates")
        return self


class SceneCameraLayer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    framing: str = Field(default="", max_length=500, strict=True)
    viewpoint: str = Field(default="", max_length=500, strict=True)
    focal_length: str = Field(default="", max_length=500, strict=True)
    depth_of_field: str = Field(default="", max_length=500, strict=True)
    focus: Optional[SceneFocusPoint] = None
    angles: Optional[SceneLayerAngles] = None

    @model_validator(mode="after")
    def one_viewpoint(self):
        if self.angles is not None and self.viewpoint.strip():
            raise ValueError("Select a named viewpoint or angles, not both")
        return self


class SceneCompositionLayer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject_position: str = Field(default="", max_length=500, strict=True)
    spatial_layers: str = Field(default="", max_length=500, strict=True)
    leading_relation: str = Field(default="", max_length=500, strict=True)


class ScenePromptLayers(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    lighting: SceneLightingLayer = Field(default_factory=SceneLightingLayer)
    camera: SceneCameraLayer = Field(default_factory=SceneCameraLayer)
    composition: SceneCompositionLayer = Field(default_factory=SceneCompositionLayer)
