/** Reusable, meter-based design facts owned by confirmed asset revisions. */
export type SpatialVec3 = [number, number, number];
export type SpatialWallSide = 'negative_x' | 'positive_x' | 'negative_y' | 'positive_y';

export interface SpatialBuilding {
  id: string;
  label: string;
  centerM: SpatialVec3;
  dimensionsM: SpatialVec3;
  frontSide: SpatialWallSide;
}

export interface SceneSpatialConstraints {
  schemaVersion: 'iframe.scene-spatial.v1';
  coordinateSystem: 'z_up';
  unit: 'meter';
  layoutId: string;
  buildings: SpatialBuilding[];
  anchors: Array<{ id: string; buildingId: string; positionM: SpatialVec3; apertureId?: string }>;
  apertures: Array<{ id: string; buildingId: string; side: SpatialWallSide; centerM: SpatialVec3; widthM: number; heightM: number }>;
}

export interface CharacterSpatialConstraints {
  schemaVersion: 'iframe.character-spatial.v1';
  unit: 'meter';
  heightM: number;
  bodyWidthM: number;
  reachM: number;
  armSpanM?: number;
  legToTorsoRatio?: number;
  shoulderToHeadWidthRatio?: number;
  headToHeightRatio?: number;
}

export interface PropSpatialConstraints {
  schemaVersion: 'iframe.prop-spatial.v1';
  unit: 'meter';
  dimensionsM: SpatialVec3;
  gripLocalM: SpatialVec3;
}

export interface ShotSpatialConstraints {
  schemaVersion: 'iframe.shot-spatial.v1';
  coordinateSystem: 'z_up';
  unit: 'meter';
  sceneId: string;
  sceneRevision: number;
  layoutId: string;
  characters: Array<{ assetId: string; revision: number; positionM: SpatialVec3 }>;
  props: Array<{ assetId: string; revision: number; positionM: SpatialVec3 }>;
  cameras: Array<{ id: string; positionM: SpatialVec3; targetM: SpatialVec3; fovDeg: number }>;
  requiredSightlines: Array<{ fromAnchorId: string; toAnchorId: string }>;
}

export function spatialConstraintsChecksum(value: SceneSpatialConstraints): string {
  const serialized = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
