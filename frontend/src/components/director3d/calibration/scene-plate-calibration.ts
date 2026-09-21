import type { CalibratedPlacementState, CalibrationSupportLayerState, NormalizedPoint2, PerspectiveScenePlateCalibrationState, ScenePlateCompositingState } from "../types";

type Vector3 = [number, number, number];

const EPSILON = 1e-8;

export function createDefaultScenePlateCompositing(): ScenePlateCompositingState {
  return {
    revision: 1,
    enabled: false,
    layerOrder: ["background_plate", "three_d_subjects", "shadow_contact", "foreground_occlusion"],
    foregroundInputId: null,
    depthInputId: null,
    shadowContactInputId: null,
    depthOrderingMode: "none",
    shadowReceiver: { enabled: false, opacity: 0.35, softnessPx: 6, groundHeightM: 0 },
    lightDirectionHint: [0.5, -0.5, 1],
    appearance: { exposure: 1, saturation: 1, colorTemperatureK: 6500 },
    availability: { occlusion: false, depth: false, shadowContact: false },
    quality: { occlusion: "unavailable", depth: "unavailable", shadowContact: "unavailable", colorMatch: "draft" },
    parityTarget: { schemaVersion: "director-scene-plate-compositing-parity.v1", colorSpace: "srgb", alphaMode: "straight", layerOrderChecksum: "background_plate>three_d_subjects>shadow_contact>foreground_occlusion" },
  };
}

function add(left: Vector3, right: Vector3): Vector3 { return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]; }
function subtract(left: Vector3, right: Vector3): Vector3 { return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]; }
function scale(vector: Vector3, factor: number): Vector3 { return [vector[0] * factor, vector[1] * factor, vector[2] * factor]; }
function dot(left: Vector3, right: Vector3): number { return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]; }
function cross(left: Vector3, right: Vector3): Vector3 { return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]]; }
function length(vector: Vector3): number { return Math.hypot(...vector); }
function normalize(vector: Vector3): Vector3 { const magnitude = length(vector); return magnitude <= EPSILON ? [0, 0, 0] : scale(vector, 1 / magnitude); }
function distance(left: Vector3, right: Vector3): number { return length(subtract(left, right)); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum)); }

function basis(calibration: PerspectiveScenePlateCalibrationState) {
  const forward = normalize(subtract(calibration.camera.lookAtM, calibration.camera.positionM));
  const right = normalize(cross(forward, calibration.camera.worldUp));
  const up = normalize(cross(right, forward));
  if (length(forward) <= EPSILON || length(right) <= EPSILON || length(up) <= EPSILON) throw new Error("camera_basis_invalid");
  return { forward, right, up };
}

function tangents(calibration: PerspectiveScenePlateCalibrationState) {
  const vertical = Math.tan(calibration.camera.verticalFovDeg * Math.PI / 360);
  return { vertical, horizontal: vertical * calibration.imageWidth / calibration.imageHeight };
}

export function screenRay(calibration: PerspectiveScenePlateCalibrationState, point: NormalizedPoint2): { origin: Vector3; direction: Vector3 } {
  const { forward, right, up } = basis(calibration);
  const { vertical, horizontal } = tangents(calibration);
  const offsetX = (point[0] - calibration.camera.principalPointNormalized[0]) * 2 * horizontal;
  const offsetY = (calibration.camera.principalPointNormalized[1] - point[1]) * 2 * vertical;
  return { origin: [...calibration.camera.positionM], direction: normalize(add(add(forward, scale(right, offsetX)), scale(up, offsetY))) };
}

export function intersectGroundPlane(calibration: PerspectiveScenePlateCalibrationState, point: NormalizedPoint2): Vector3 | null {
  const ray = screenRay(calibration, point);
  if (Math.abs(ray.direction[2]) <= EPSILON) return null;
  const distanceAlongRay = (calibration.groundPlane.heightM - ray.origin[2]) / ray.direction[2];
  if (distanceAlongRay <= 0) return null;
  return add(ray.origin, scale(ray.direction, distanceAlongRay));
}

function sampleDepthGrid(layer: CalibrationSupportLayerState, point: NormalizedPoint2): number | null {
  const surface = layer.depthSurface;
  if (!layer.confirmed || layer.role !== "calibration_depth" || !surface || surface.samplesNormalized.length !== surface.gridWidth * surface.gridHeight) return null;
  const x = clamp(point[0], 0, 1) * (surface.gridWidth - 1);
  const y = clamp(point[1], 0, 1) * (surface.gridHeight - 1);
  const x0 = Math.floor(x); const x1 = Math.min(surface.gridWidth - 1, x0 + 1);
  const y0 = Math.floor(y); const y1 = Math.min(surface.gridHeight - 1, y0 + 1);
  const tx = x - x0; const ty = y - y0;
  const at = (column: number, row: number) => surface.samplesNormalized[row * surface.gridWidth + column];
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function intersectDepthSurface(calibration: PerspectiveScenePlateCalibrationState, layer: CalibrationSupportLayerState, point: NormalizedPoint2): Vector3 | null {
  const normalizedDepth = sampleDepthGrid(layer, point);
  if (normalizedDepth === null || !layer.depthSurface || layer.calibrationRevision !== calibration.revision || layer.sourceScenePlateInputId !== calibration.sourceInputId) return null;
  const distanceAlongRay = layer.depthSurface.nearM + normalizedDepth * (layer.depthSurface.farM - layer.depthSurface.nearM);
  if (!Number.isFinite(distanceAlongRay) || distanceAlongRay <= 0) return null;
  const ray = screenRay(calibration, point);
  const world = add(ray.origin, scale(ray.direction, distanceAlongRay));
  return world.every((value, axis) => value >= calibration.workingBoundsM.minimum[axis] && value <= calibration.workingBoundsM.maximum[axis]) ? world : null;
}

export function projectWorldPoint(calibration: PerspectiveScenePlateCalibrationState, point: Vector3): NormalizedPoint2 | null {
  const relative = subtract(point, calibration.camera.positionM);
  const { forward, right, up } = basis(calibration);
  const depth = dot(relative, forward);
  if (depth <= EPSILON) return null;
  const { vertical, horizontal } = tangents(calibration);
  return [
    calibration.camera.principalPointNormalized[0] + dot(relative, right) / depth / (2 * horizontal),
    calibration.camera.principalPointNormalized[1] - dot(relative, up) / depth / (2 * vertical),
  ];
}

function horizonProjection(calibration: PerspectiveScenePlateCalibrationState): NormalizedPoint2 | null {
  const horizontalForward = normalize([calibration.camera.lookAtM[0] - calibration.camera.positionM[0], calibration.camera.lookAtM[1] - calibration.camera.positionM[1], 0]);
  if (length(horizontalForward) <= EPSILON) return null;
  return projectWorldPoint(calibration, add(calibration.camera.positionM, scale(horizontalForward, 10_000)));
}

export function evaluateScenePlateCalibration(calibration: PerspectiveScenePlateCalibrationState): PerspectiveScenePlateCalibrationState {
  const cropX = clamp(calibration.cropNormalized.x, 0, 0.999);
  const cropY = clamp(calibration.cropNormalized.y, 0, 0.999);
  const normalizedCalibration = {
    ...calibration,
    cropNormalized: { x: cropX, y: cropY, width: clamp(calibration.cropNormalized.width, 0.001, 1 - cropX), height: clamp(calibration.cropNormalized.height, 0.001, 1 - cropY) },
    workingBoundsM: { minimum: [...calibration.workingBoundsM.minimum] as Vector3, maximum: calibration.workingBoundsM.maximum.map((value, axis) => Math.max(value, calibration.workingBoundsM.minimum[axis] + 0.001)) as Vector3 },
  };
  let horizon: NormalizedPoint2 | null = null; let start: Vector3 | null = null; let end: Vector3 | null = null;
  try {
    horizon = horizonProjection(normalizedCalibration);
    start = intersectGroundPlane(normalizedCalibration, normalizedCalibration.scaleAnchor.startNormalized);
    end = intersectGroundPlane(normalizedCalibration, normalizedCalibration.scaleAnchor.endNormalized);
  } catch {
    // Invalid explicit camera bases remain a visible draft instead of crashing authoring.
  }
  const horizonResidualPx = horizon ? Math.abs(horizon[1] - normalizedCalibration.horizonYNormalized) * normalizedCalibration.imageHeight : normalizedCalibration.imageHeight;
  const measuredDistance = start && end ? distance(start, end) : 0;
  const scaleErrorRatio = measuredDistance > 0 && normalizedCalibration.scaleAnchor.distanceM > 0 ? Math.abs(measuredDistance - normalizedCalibration.scaleAnchor.distanceM) / normalizedCalibration.scaleAnchor.distanceM : 1;
  const qualityState = horizonResidualPx <= 5 && scaleErrorRatio <= 0.05 ? "verified" : horizonResidualPx <= 25 && scaleErrorRatio <= 0.2 ? "usable" : "draft";
  const confidence = clamp(1 - horizonResidualPx / Math.max(1, normalizedCalibration.imageHeight * 0.15) - scaleErrorRatio * 0.7, 0, 1);
  return { ...normalizedCalibration, horizonResidualPx, scaleErrorRatio, qualityState, confidence };
}

export function createManualScenePlateCalibration(input: { inputId: string; width: number; height: number }, sequence = 1): PerspectiveScenePlateCalibrationState {
  return evaluateScenePlateCalibration({
    calibrationId: `calibration-scene-plate-${String(sequence).padStart(3, "0")}`,
    revision: 1,
    sourceInputId: input.inputId,
    imageWidth: input.width,
    imageHeight: input.height,
    fitMode: "contain",
    cropNormalized: { x: 0, y: 0, width: 1, height: 1 },
    horizonYNormalized: 0.42,
    verticalDirectionNormalized: [0.5, 0.1],
    groundRegionNormalized: [[0.08, 0.55], [0.92, 0.55], [0.98, 0.98], [0.02, 0.98]],
    worldOriginM: [0, 0, 0],
    camera: { positionM: [0, -5, 1.6], lookAtM: [0, 2, 0], worldUp: [0, 0, 1], verticalFovDeg: 50, principalPointNormalized: [0.5, 0.5] },
    groundPlane: { heightM: 0 },
    scaleAnchor: { startNormalized: [0.38, 0.82], endNormalized: [0.62, 0.82], distanceM: 2 },
    workingBoundsM: { minimum: [-20, -20, -2], maximum: [20, 20, 20] },
    method: "manual",
    horizonResidualPx: 0,
    scaleErrorRatio: 1,
    confidence: 0,
    qualityState: "draft",
    confirmed: false,
    supportLayers: [],
    compositing: createDefaultScenePlateCompositing(),
  });
}

export function placeTargetOnScenePlate(calibration: PerspectiveScenePlateCalibrationState, target: { targetType: "character" | "scene_object"; targetId: string }, screenAnchor: NormalizedPoint2, depthLayer: CalibrationSupportLayerState | null = null): CalibratedPlacementState {
  if (!calibration.confirmed) throw new Error("calibration_not_confirmed");
  const worldPositionM = depthLayer ? intersectDepthSurface(calibration, depthLayer, screenAnchor) : intersectGroundPlane(calibration, screenAnchor);
  if (!worldPositionM) throw new Error("placement_surface_unavailable");
  const reprojectedNormalized = projectWorldPoint(calibration, worldPositionM);
  if (!reprojectedNormalized) throw new Error("placement_reprojection_unavailable");
  const reprojectionErrorPx = Math.hypot((reprojectedNormalized[0] - screenAnchor[0]) * calibration.imageWidth, (reprojectedNormalized[1] - screenAnchor[1]) * calibration.imageHeight);
  return { targetType: target.targetType, targetId: target.targetId, calibrationId: calibration.calibrationId, calibrationRevision: calibration.revision, screenAnchorNormalized: screenAnchor, placementSurface: depthLayer ? "depth_surface" : "ground_plane", placementSurfaceInputId: depthLayer?.inputId ?? null, worldPositionM, reprojectedNormalized, reprojectionErrorPx, confidence: Math.min(calibration.confidence, depthLayer?.qualityState === "verified" ? 1 : depthLayer ? 0.75 : 1), reviewRequired: false };
}

export function pointInsideGroundRegion(calibration: PerspectiveScenePlateCalibrationState, point: NormalizedPoint2): boolean {
  let inside = false;
  const polygon = calibration.groundRegionNormalized;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, yi] = polygon[index]; const [xj, yj] = polygon[previous];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
