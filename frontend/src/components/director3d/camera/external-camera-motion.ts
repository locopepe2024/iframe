import type { ActorPathControlPointState, ExternalCameraCoordinateSystem, ExternalCameraMotionProposalState, ExternalCameraMotionSampleState } from "../types";

const MAX_SAMPLES = 2000;
const MAX_DURATION_SECONDS = 600;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const vec3 = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(finite);

export interface ExternalCameraMotionManifest {
  source_input_id: string;
  source_checksum: string;
  coordinate_system: ExternalCameraCoordinateSystem;
  units_per_meter?: number;
  samples: Array<{ timestamp_seconds: number; position: [number, number, number]; orientation_deg?: [number, number, number] }>;
}

export function convertExternalSample(sample: { position: [number, number, number]; orientationDeg: [number, number, number] }, coordinateSystem: ExternalCameraCoordinateSystem, unitsPerMeter: number, scaleMultiplier: number, originM: [number, number, number], rotationOffsetDeg: [number, number, number]) {
  const [x, y, z] = sample.position;
  const position: [number, number, number] = coordinateSystem === "director_z_up" ? [x, y, z] : coordinateSystem === "arkit_right_handed_y_up" ? [x, z, -y] : [x, z, y];
  const scale = scaleMultiplier / unitsPerMeter;
  const [rx, ry, rz] = sample.orientationDeg;
  const orientation: [number, number, number] = coordinateSystem === "director_z_up" ? [rx, ry, rz] : coordinateSystem === "arkit_right_handed_y_up" ? [rx, rz, -ry] : [rx, rz, ry];
  return {
    convertedPositionM: position.map((value, axis) => value * scale + originM[axis]) as [number, number, number],
    convertedOrientationDeg: orientation.map((value, axis) => value + rotationOffsetDeg[axis]) as [number, number, number],
  };
}

export function smoothSamples(samples: ExternalCameraMotionSampleState[], windowSize: number): ExternalCameraMotionSampleState[] {
  const radius = Math.floor(windowSize / 2);
  if (radius <= 0) return samples.map((sample) => ({ ...sample, convertedPositionM: [...sample.convertedPositionM] as [number, number, number], convertedOrientationDeg: [...sample.convertedOrientationDeg] as [number, number, number] }));
  return samples.map((sample, index) => {
    const selected = samples.slice(Math.max(0, index - radius), Math.min(samples.length, index + radius + 1));
    const average = (field: "convertedPositionM" | "convertedOrientationDeg") => selected.reduce((sum, item) => sum.map((value, axis) => value + item[field][axis]) as [number, number, number], [0, 0, 0]).map((value) => value / selected.length) as [number, number, number];
    return { ...sample, convertedPositionM: average("convertedPositionM"), convertedOrientationDeg: average("convertedOrientationDeg") };
  });
}

export function parseExternalCameraMotionManifest(value: unknown, defaults: { timelineStartSeconds?: number; audioOffsetSeconds?: number; smoothingWindow?: number; scaleMultiplier?: number; originM?: [number, number, number]; rotationOffsetDeg?: [number, number, number] } = {}): ExternalCameraMotionProposalState {
  if (!value || typeof value !== "object") throw new Error("运动 manifest 必须是 JSON 对象");
  const input = value as Partial<ExternalCameraMotionManifest>;
  if (typeof input.source_input_id !== "string" || typeof input.source_checksum !== "string") throw new Error("缺少源输入 ID 或 checksum");
  if (!Array.isArray(input.samples) || input.samples.length < 2 || input.samples.length > MAX_SAMPLES) throw new Error("samples 必须是 2-2000 个有界样本");
  if (!["director_z_up", "arkit_right_handed_y_up", "android_right_handed_y_up"].includes(String(input.coordinate_system))) throw new Error("不支持的坐标系");
  const unitsPerMeter = input.units_per_meter ?? 1;
  if (!finite(unitsPerMeter) || unitsPerMeter <= 0 || unitsPerMeter > 1000) throw new Error("units_per_meter 必须为正数");
  let previous = -Infinity;
  const raw = input.samples.map((sample) => {
    if (!finite(sample.timestamp_seconds) || sample.timestamp_seconds < 0 || sample.timestamp_seconds <= previous || !vec3(sample.position) || (sample.orientation_deg !== undefined && !vec3(sample.orientation_deg))) throw new Error("样本时间必须严格递增且向量有限");
    previous = sample.timestamp_seconds;
    return { timestampSeconds: sample.timestamp_seconds, position: sample.position, orientationDeg: sample.orientation_deg ?? [0, 0, 0] as [number, number, number] };
  });
  if (previous > MAX_DURATION_SECONDS) throw new Error("运动时长超过 600 秒上限");
  const timelineStartSeconds = defaults.timelineStartSeconds ?? 0;
  const audioOffsetSeconds = defaults.audioOffsetSeconds ?? 0;
  const smoothingWindow = Math.max(1, Math.min(31, Math.round(defaults.smoothingWindow ?? 1)));
  const scaleMultiplier = defaults.scaleMultiplier ?? 1;
  const originM = defaults.originM ?? [0, 0, 0];
  const rotationOffsetDeg = defaults.rotationOffsetDeg ?? [0, 0, 0];
  if (!finite(scaleMultiplier) || scaleMultiplier <= 0 || !vec3(originM) || !vec3(rotationOffsetDeg)) throw new Error("校准参数无效");
  const converted = raw.map((sample) => ({ ...sample, ...convertExternalSample(sample, input.coordinate_system!, unitsPerMeter, scaleMultiplier, originM, rotationOffsetDeg), alignedTimeSeconds: timelineStartSeconds + sample.timestampSeconds + audioOffsetSeconds }));
  const smoothed = smoothSamples(converted, smoothingWindow);
  return { proposalId: `camera-motion-proposal-${crypto.randomUUID()}`, revision: 1, sourceInputId: input.source_input_id, sourceChecksum: input.source_checksum, targetCameraId: "", audioInputId: null, audioChecksum: null, coordinateSystem: input.coordinate_system!, unitsPerMeter, scaleMultiplier, originM, rotationOffsetDeg, sourceStartSeconds: raw[0].timestampSeconds, timelineStartSeconds, audioOffsetSeconds, smoothingWindow, rawSamples: raw.map((sample) => ({ ...sample, convertedPositionM: sample.position, convertedOrientationDeg: sample.orientationDeg, alignedTimeSeconds: timelineStartSeconds + sample.timestampSeconds + audioOffsetSeconds })), convertedSamples: smoothed, confidence: 0, limitations: ["camera_path_encodes_position_only_orientation_retained_in_proposal"], reviewState: "proposed", appliedPathId: null, appliedPathRevision: null };
}

export function downsampleToBezierPoints(samples: ExternalCameraMotionSampleState[], maxPoints = 128): ActorPathControlPointState[] {
  const points = samples.length <= maxPoints ? samples : samples.filter((_, index) => index === 0 || index === samples.length - 1 || index % Math.ceil(samples.length / maxPoints) === 0).slice(0, maxPoints);
  return points.map((sample, index) => {
    const previous = points[index - 1]?.convertedPositionM ?? sample.convertedPositionM;
    const next = points[index + 1]?.convertedPositionM ?? sample.convertedPositionM;
    const tangent = next.map((value, axis) => (value - previous[axis]) / 3) as [number, number, number];
    return { controlPointId: `point-external-camera-${String(index + 1).padStart(4, "0")}`, positionM: sample.convertedPositionM, handleInM: sample.convertedPositionM.map((value, axis) => value - tangent[axis]) as [number, number, number], handleOutM: sample.convertedPositionM.map((value, axis) => value + tangent[axis]) as [number, number, number], order: index };
  });
}
