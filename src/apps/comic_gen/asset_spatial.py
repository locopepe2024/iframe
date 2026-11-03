"""Metric facts owned by confirmed asset designs, independent of Director 3D."""

from math import isfinite
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


Vec3 = tuple[float, float, float]
WallSide = Literal["negative_x", "positive_x", "negative_y", "positive_y"]


class SpatialBuilding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    centerM: Vec3
    dimensionsM: Vec3
    frontSide: WallSide

    @model_validator(mode="after")
    def valid_size(self):
        if any(not 0 < value <= 10000 for value in self.dimensionsM):
            raise ValueError("Building dimensions must be positive bounded meters")
        return self


class SpatialAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    buildingId: str = Field(min_length=1, max_length=100)
    positionM: Vec3
    apertureId: str | None = None


class SpatialAperture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    buildingId: str = Field(min_length=1, max_length=100)
    side: WallSide
    centerM: Vec3
    widthM: float = Field(gt=0, le=10000)
    heightM: float = Field(gt=0, le=10000)


class SceneSpatialConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal["iframe.scene-spatial.v1"]
    coordinateSystem: Literal["z_up"]
    unit: Literal["meter"]
    layoutId: str = Field(min_length=1, max_length=100)
    buildings: list[SpatialBuilding] = Field(max_length=500)
    anchors: list[SpatialAnchor] = Field(max_length=1000)
    apertures: list[SpatialAperture] = Field(max_length=1000)

    @model_validator(mode="after")
    def valid_references(self):
        buildings = {item.id for item in self.buildings}
        apertures = {item.id: item for item in self.apertures}
        if len(buildings) != len(self.buildings) or len(apertures) != len(self.apertures) or len({item.id for item in self.anchors}) != len(self.anchors):
            raise ValueError("Spatial IDs must be unique within their kind")
        if any(item.buildingId not in buildings for item in self.apertures):
            raise ValueError("Aperture building is missing")
        for anchor in self.anchors:
            if anchor.buildingId not in buildings:
                raise ValueError("Anchor building is missing")
            if anchor.apertureId and (anchor.apertureId not in apertures or apertures[anchor.apertureId].buildingId != anchor.buildingId):
                raise ValueError("Anchor aperture is missing or belongs to another building")
        return self


class CharacterSpatialConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal["iframe.character-spatial.v1"]
    unit: Literal["meter"]
    heightM: float = Field(gt=0, le=5)
    bodyWidthM: float = Field(gt=0, le=5)
    reachM: float = Field(gt=0, le=5)


class PropSpatialConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal["iframe.prop-spatial.v1"]
    unit: Literal["meter"]
    dimensionsM: Vec3
    gripLocalM: Vec3

    @model_validator(mode="after")
    def valid_grip(self):
        if any(not 0 < value <= 10000 for value in self.dimensionsM):
            raise ValueError("Prop dimensions must be positive bounded meters")
        if any(abs(value) > self.dimensionsM[index] / 2 for index, value in enumerate(self.gripLocalM)):
            raise ValueError("Prop grip must lie within its dimensions")
        return self


class ShotPlacement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assetId: str = Field(min_length=1, max_length=100)
    revision: int = Field(ge=1)
    positionM: Vec3


class ShotCamera(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    positionM: Vec3
    targetM: Vec3
    fovDeg: float = Field(gt=0, lt=180, allow_inf_nan=False)


class ShotSightline(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fromAnchorId: str = Field(min_length=1, max_length=100)
    toAnchorId: str = Field(min_length=1, max_length=100)


class ShotSpatialConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal["iframe.shot-spatial.v1"]
    coordinateSystem: Literal["z_up"]
    unit: Literal["meter"]
    sceneId: str = Field(min_length=1, max_length=100)
    sceneRevision: int = Field(ge=1)
    layoutId: str = Field(min_length=1, max_length=100)
    characters: list[ShotPlacement] = Field(default_factory=list, max_length=100)
    props: list[ShotPlacement] = Field(default_factory=list, max_length=100)
    cameras: list[ShotCamera] = Field(default_factory=list, max_length=100)
    requiredSightlines: list[ShotSightline] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid_layout(self):
        vectors = [item.positionM for item in [*self.characters, *self.props, *self.cameras]]
        vectors.extend(camera.targetM for camera in self.cameras)
        if any(not all(isfinite(value) for value in vector) for vector in vectors):
            raise ValueError("Shot spatial positions must be finite meters")
        if any(camera.positionM == camera.targetM for camera in self.cameras):
            raise ValueError("Shot camera target must differ from its position")
        for items in (self.characters, self.props):
            if len({item.assetId for item in items}) != len(items):
                raise ValueError("Shot spatial asset IDs must be unique")
        if len({camera.id for camera in self.cameras}) != len(self.cameras):
            raise ValueError("Shot camera IDs must be unique")
        return self
