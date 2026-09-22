import type { ActorPathControlPointState, CameraPathPresetId } from "../types";

type Vector3 = [number, number, number];

export const CAMERA_PATH_PRESETS: ReadonlyArray<{ presetId: CameraPathPresetId; label: string; description: string }> = [
  { presetId: "orbit", label: "环绕一周", description: "围绕构图目标完成 360° 环绕。" },
  { presetId: "half_arc", label: "半弧环绕", description: "围绕构图目标完成 180° 半弧。" },
  { presetId: "push_in", label: "推进", description: "沿目标方向平滑靠近。" },
  { presetId: "pull_out", label: "拉远", description: "沿目标反方向平滑后撤。" },
  { presetId: "lift", label: "升起", description: "保持平面位置并向上升起。" },
  { presetId: "drop", label: "下降", description: "保持平面位置并向下降低。" },
  { presetId: "lateral", label: "横移", description: "相对目标视线向舞台右侧横移。" },
  { presetId: "spiral_rise", label: "螺旋上升", description: "围绕目标旋转一周半并逐步升高。" },
];

function add(left: Vector3, right: Vector3): Vector3 { return left.map((value, index) => value + right[index]) as Vector3; }
function subtract(left: Vector3, right: Vector3): Vector3 { return left.map((value, index) => value - right[index]) as Vector3; }
function scale(value: Vector3, factor: number): Vector3 { return value.map((item) => item * factor) as Vector3; }
function length(value: Vector3): number { return Math.hypot(...value); }
function normalized(value: Vector3, fallback: Vector3): Vector3 { const magnitude = length(value); return magnitude > 1e-6 ? scale(value, 1 / magnitude) : [...fallback]; }
function pointId(cameraId: string, presetId: CameraPathPresetId, sequence: number, index: number): string { return `point-${cameraId}-${presetId.replaceAll("_", "-")}-${String(sequence).padStart(3, "0")}-${String(index + 1).padStart(2, "0")}`; }

function linePoints(cameraId: string, presetId: CameraPathPresetId, sequence: number, start: Vector3, end: Vector3): ActorPathControlPointState[] {
  const delta = subtract(end, start);
  return [
    { controlPointId: pointId(cameraId, presetId, sequence, 0), positionM: start, handleInM: start, handleOutM: add(start, scale(delta, 1 / 3)), order: 0 },
    { controlPointId: pointId(cameraId, presetId, sequence, 1), positionM: end, handleInM: add(start, scale(delta, 2 / 3)), handleOutM: end, order: 1 },
  ];
}

function arcPoints(cameraId: string, presetId: CameraPathPresetId, sequence: number, start: Vector3, target: Vector3, segmentCount: number, turns: number, riseM: number): ActorPathControlPointState[] {
  const offset = subtract(start, target);
  const radius = Math.max(0.75, Math.hypot(offset[0], offset[1]));
  const startAngle = Math.hypot(offset[0], offset[1]) > 1e-6 ? Math.atan2(offset[1], offset[0]) : -Math.PI / 2;
  const startHeight = start[2];
  const deltaAngle = turns * Math.PI * 2 / segmentCount;
  const handleScale = 4 / 3 * Math.tan(Math.abs(deltaAngle) / 4) * radius;
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const progress = index / segmentCount;
    const angle = startAngle + deltaAngle * index;
    const closesAtStart = index === segmentCount && riseM === 0 && Math.abs(turns - Math.round(turns)) < 1e-9;
    const position: Vector3 = index === 0 || closesAtStart
      ? [...start]
      : [target[0] + Math.cos(angle) * radius, target[1] + Math.sin(angle) * radius, startHeight + riseM * progress];
    const tangent: Vector3 = [-Math.sin(angle), Math.cos(angle), riseM / (Math.abs(turns * Math.PI * 2) * radius || 1)];
    const handleDelta = scale(normalized(tangent, [0, 1, 0]), handleScale);
    return {
      controlPointId: pointId(cameraId, presetId, sequence, index),
      positionM: position,
      handleInM: index === 0 ? position : subtract(position, handleDelta),
      handleOutM: index === segmentCount ? position : add(position, handleDelta),
      order: index,
    };
  });
}

export function createCameraPathPresetControlPoints(input: { cameraId: string; presetId: CameraPathPresetId; sequence: number; startPositionM: Vector3; targetPositionM: Vector3 }): ActorPathControlPointState[] {
  const { cameraId, presetId, sequence, startPositionM: start, targetPositionM: target } = input;
  const towardTarget = normalized(subtract(target, start), [0, 1, 0]);
  const horizontalToward = normalized([towardTarget[0], towardTarget[1], 0], [0, 1, 0]);
  if (presetId === "orbit") return arcPoints(cameraId, presetId, sequence, start, target, 4, 1, 0);
  if (presetId === "half_arc") return arcPoints(cameraId, presetId, sequence, start, target, 2, 0.5, 0);
  if (presetId === "spiral_rise") return arcPoints(cameraId, presetId, sequence, start, target, 6, 1.5, 2.5);
  if (presetId === "push_in") {
    const distance = length(subtract(target, start));
    return linePoints(cameraId, presetId, sequence, start, add(start, scale(towardTarget, Math.min(Math.max(distance - 0.75, 0.5), 2.5))));
  }
  if (presetId === "pull_out") return linePoints(cameraId, presetId, sequence, start, add(start, scale(towardTarget, -2.5)));
  if (presetId === "lift") return linePoints(cameraId, presetId, sequence, start, add(start, [0, 0, 2.5]));
  if (presetId === "drop") return linePoints(cameraId, presetId, sequence, start, add(start, [0, 0, -2.5]));
  const right: Vector3 = [horizontalToward[1], -horizontalToward[0], 0];
  return linePoints(cameraId, presetId, sequence, start, add(start, scale(right, 2.5)));
}
