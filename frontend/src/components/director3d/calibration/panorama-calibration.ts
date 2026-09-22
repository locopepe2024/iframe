import type { EquirectangularPanoramaCalibrationState } from "../types";

function normalized(vector: [number, number, number], fallback: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length < 1e-6) return [...fallback];
  return vector.map((value) => value / length) as [number, number, number];
}

export function createManualPanoramaCalibration(inputId: string, sequence = 1): EquirectangularPanoramaCalibrationState {
  return {
    calibrationId: `calibration-panorama-${String(sequence).padStart(3, "0")}`,
    revision: 1,
    sourceInputId: inputId,
    projectionType: "equirectangular",
    orientationDeg: { yaw: 0, pitch: 0, roll: 0 },
    forwardDirection: [0, 1, 0],
    northDirection: [0, 1, 0],
    horizonYNormalized: 0.5,
    scaleConvention: "metric_sphere_radius",
    radiusM: 10,
    groundHeightM: 0,
    worldOriginM: [0, 0, 0],
    exposure: 1,
    contactAlignment: { enabled: false, azimuthDeg: 0, groundOffsetM: 0 },
    method: "manual",
    qualityState: "draft",
    confidence: 0,
    confirmed: false,
  };
}

export function evaluatePanoramaCalibration(calibration: EquirectangularPanoramaCalibrationState): EquirectangularPanoramaCalibrationState {
  const forwardLength = Math.hypot(...calibration.forwardDirection);
  const northLength = Math.hypot(...calibration.northDirection);
  const forwardDirection = normalized(calibration.forwardDirection, [0, 1, 0]);
  const northDirection = normalized(calibration.northDirection, forwardDirection);
  const usable = calibration.projectionType === "equirectangular"
    && calibration.radiusM >= 1
    && calibration.horizonYNormalized >= 0
    && calibration.horizonYNormalized <= 1
    && Number.isFinite(forwardLength)
    && Number.isFinite(northLength)
    && forwardLength >= 1e-6
    && northLength >= 1e-6
    && Math.abs(forwardDirection[2]) <= 0.999
    && Math.abs(northDirection[2]) <= 0.999;
  const confidence = usable ? Math.min(1, Math.max(0.5, calibration.confidence)) : 0;
  return {
    ...calibration,
    forwardDirection,
    northDirection,
    confidence,
    qualityState: usable ? (calibration.confirmed ? "verified" : "usable") : "draft",
  };
}

export function panoramaRotationTuple(calibration: EquirectangularPanoramaCalibrationState): [number, number, number] {
  return [calibration.orientationDeg.pitch, calibration.orientationDeg.roll, calibration.orientationDeg.yaw];
}
