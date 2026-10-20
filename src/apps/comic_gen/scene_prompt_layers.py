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
    angles: Optional[SceneLayerAngles] = None

    @model_validator(mode="after")
    def one_direction(self):
        if self.angles is not None and self.direction.strip():
            raise ValueError("Select a named direction or angles, not both")
        return self


class SceneCameraLayer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    framing: str = Field(default="", max_length=500, strict=True)
    viewpoint: str = Field(default="", max_length=500, strict=True)
    focal_length: str = Field(default="", max_length=500, strict=True)
    depth_of_field: str = Field(default="", max_length=500, strict=True)
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
