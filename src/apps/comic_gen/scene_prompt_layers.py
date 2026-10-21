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
    frame_orientation: str = Field(default="", max_length=500, strict=True)
    subject_position: str = Field(default="", max_length=500, strict=True)
    spatial_layers: str = Field(default="", max_length=500, strict=True)
    leading_relation: str = Field(default="", max_length=500, strict=True)


class ScenePromptLayers(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    lighting: SceneLightingLayer = Field(default_factory=SceneLightingLayer)
    camera: SceneCameraLayer = Field(default_factory=SceneCameraLayer)
    composition: SceneCompositionLayer = Field(default_factory=SceneCompositionLayer)


# Shared label/order contract with SCENE_LAYER_FIELDS; tool panels expose only
# non-overlapping fields so numeric direction/color/focus controls stay owners.
TOOL_LAYER_FIELDS = {
    "lighting": {
        "source": "光源", "quality": "软硬", "fill": "补光", "contrast": "反差",
        "shadow": "阴影", "rim": "轮廓光", "mood": "氛围", "air": "空气介质",
    },
    "camera": {"focal_length": "焦距观感", "depth_of_field": "景深"},
    "composition": {
        "frame_orientation": "画面倾斜", "subject_position": "主体位置",
        "spatial_layers": "空间层次", "leading_relation": "引导关系",
    },
}


def validate_tool_panel(layers: ScenePromptLayers, kind: str) -> None:
    data = layers.model_dump(exclude_unset=True)
    allowed_layers = ("lighting",) if kind == "lighting" else ("camera", "composition")
    for layer, fields in data.items():
        if layer == "version":
            continue
        # Revalidated queued records may contain model_dump defaults. Empty
        # defaults add no instruction; reject only effective duplicate fields.
        meaningful = {key for key, value in fields.items() if value is not None and value != "" and value != {}}
        if meaningful and (layer not in allowed_layers or meaningful - set(TOOL_LAYER_FIELDS[layer])):
            raise ValueError("Tool panel settings duplicate or conflict with dedicated controls")


def compile_tool_panel(layers: ScenePromptLayers) -> str:
    lines = []
    for layer, title in (("lighting", "光影"), ("camera", "镜头"), ("composition", "构图")):
        values = getattr(layers, layer)
        parts = [f"{label}：{getattr(values, key).strip()}" for key, label in TOOL_LAYER_FIELDS[layer].items() if getattr(values, key).strip()]
        if parts:
            lines.append(f"{title}：" + "；".join(parts))
    return "\n".join(lines)
