import type { CharacterAuthoringState } from "../state/workbench-store";
import type { ActorPathEasing, ActorPathState, CameraCompositionState, CameraPathState, SceneObjectAuthoringState, TimelineKeyframeState, TimelineTrackState } from "../types";

type Vector3 = [number, number, number];

export interface EvaluatedDirectorFrame {
  timeSeconds: number;
  activeCameraId: string;
  characters: Record<string, CharacterAuthoringState>;
  cameras: Record<string, CameraCompositionState>;
  sceneObjects: Record<string, SceneObjectAuthoringState>;
  activeCameraProjection: ReturnType<typeof cameraProjection> | null;
  activeCameraPositionM: Vector3 | null;
  activeCameraTargetM: Vector3 | null;
}

function clamp01(value: number): number { return Math.min(1, Math.max(0, value)); }

export function frameTimeSeconds(frame: number, fps: number, durationSeconds: number): number {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.min(durationSeconds, Math.max(0, (Math.round(frame) - 1) / fps));
}

export function easePathProgress(easing: ActorPathEasing, progress: number): number {
  const t = clamp01(progress);
  if (easing === "ease_in") return t * t;
  if (easing === "ease_out") return 1 - (1 - t) * (1 - t);
  if (easing === "ease_in_out") return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  if (easing === "bezier") return t * t * (3 - 2 * t);
  return t;
}

function cubicBezier(a: number, b: number, c: number, d: number, t: number): number {
  const inverse = 1 - t;
  return inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d;
}

export function evaluatePathPosition(path: ActorPathState | CameraPathState, timeSeconds: number, progressOverride?: number): Vector3 {
  const points = [...path.controlPoints].sort((left, right) => left.order - right.order);
  if (points.length === 0) return [0, 0, 0];
  if (points.length === 1) return [...points[0].positionM];
  const progress = progressOverride === undefined ? easePathProgress(path.easing, timeSeconds / Math.max(0.000001, path.durationSeconds)) : clamp01(progressOverride);
  const scaled = progress * (points.length - 1);
  const segment = Math.min(points.length - 2, Math.floor(scaled));
  const local = progress >= 1 ? 1 : scaled - segment;
  const start = points[segment]; const end = points[segment + 1];
  return [0, 1, 2].map((axis) => cubicBezier(start.positionM[axis], start.handleOutM[axis], end.handleInM[axis], end.positionM[axis], local)) as Vector3;
}

function interpolateValue(left: unknown, right: unknown, amount: number): unknown {
  if (typeof left === "number" && typeof right === "number") return left + (right - left) * amount;
  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) return left.map((value, index) => interpolateValue(value, right[index], amount));
  if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
    const leftRecord = left as Record<string, unknown>; const rightRecord = right as Record<string, unknown>;
    if (Object.keys(leftRecord).length === Object.keys(rightRecord).length && Object.keys(leftRecord).every((key) => key in rightRecord)) return Object.fromEntries(Object.keys(leftRecord).map((key) => [key, interpolateValue(leftRecord[key], rightRecord[key], amount)]));
  }
  return amount < 1 ? structuredClone(left) : structuredClone(right);
}

export function evaluateKeyframes(keyframes: TimelineKeyframeState[], timeSeconds: number): unknown {
  const ordered = [...keyframes].sort((left, right) => left.timeSeconds - right.timeSeconds || left.keyframeId.localeCompare(right.keyframeId));
  if (ordered.length === 0) return undefined;
  if (timeSeconds <= ordered[0].timeSeconds) return structuredClone(ordered[0].value);
  if (timeSeconds >= ordered.at(-1)!.timeSeconds) return structuredClone(ordered.at(-1)!.value);
  const rightIndex = ordered.findIndex((keyframe) => keyframe.timeSeconds > timeSeconds);
  const left = ordered[rightIndex - 1]; const right = ordered[rightIndex];
  if (left.interpolation === "step") return structuredClone(left.value);
  const raw = (timeSeconds - left.timeSeconds) / (right.timeSeconds - left.timeSeconds);
  const amount = left.interpolation === "bezier" ? raw * raw * (3 - 2 * raw) : raw;
  return interpolateValue(left.value, right.value, amount);
}

export function aspectRatioValue(aspectRatio: CameraCompositionState["aspectRatio"]): number {
  const normalized = aspectRatio === "auto" ? "16:9" : aspectRatio;
  const [width, height] = normalized.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

export function cameraProjection(fovDeg: number, zoom: number, aspectRatio: CameraCompositionState["aspectRatio"]) {
  const aspect = aspectRatioValue(aspectRatio);
  const safeZoom = Math.min(10, Math.max(0.1, zoom));
  const horizontalRadians = 2 * Math.atan(Math.tan(Math.PI * Math.min(140, Math.max(10, fovDeg)) / 360) / safeZoom);
  const verticalRadians = 2 * Math.atan(Math.tan(horizontalRadians / 2) / aspect);
  return {
    aspect,
    horizontalFovDeg: horizontalRadians * 180 / Math.PI,
    verticalFovDeg: verticalRadians * 180 / Math.PI,
    focalLengthMm: 36 / (2 * Math.tan(horizontalRadians / 2)),
    projectionScaleX: 1 / Math.tan(horizontalRadians / 2),
    projectionScaleY: 1 / Math.tan(verticalRadians / 2),
  };
}

export function stateTargetPosition(targetId: string, characters: Record<string, CharacterAuthoringState>, sceneObjects: Record<string, SceneObjectAuthoringState>): Vector3 | null {
  const character = characters[targetId];
  if (character) return [character.transform.position[0], character.transform.position[1], character.transform.position[2] + 1];
  const sceneObject = sceneObjects[targetId];
  if (sceneObject) return [sceneObject.transform.position[0], sceneObject.transform.position[1], sceneObject.transform.position[2] + sceneObject.dimensionsM[2] / 2];
  return null;
}

export function cameraTargetPosition(target: CameraCompositionState["lookAt"], characters: Record<string, CharacterAuthoringState>, sceneObjects: Record<string, SceneObjectAuthoringState>): Vector3 | null {
  return target ? stateTargetPosition(target.targetId, characters, sceneObjects) : null;
}

export function cameraRuntimePosition(camera: CameraCompositionState, followTargetM: Vector3 | null): Vector3 {
  if (!camera.follow || !followTargetM) return [...camera.transform.position];
  return camera.transform.position.map((value, index) => value + followTargetM[index]) as Vector3;
}

export function cameraForwardTarget(camera: CameraCompositionState): Vector3 {
  const [rx, ry, rz] = camera.transform.rotationDeg.map((value) => value * Math.PI / 180);
  let x = 0; let y = Math.sin(rx); let z = -Math.cos(rx);
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [camera.transform.position[0] + x, camera.transform.position[1] + y, camera.transform.position[2] + z];
}

export function cameraRuntime(camera: CameraCompositionState, characters: Record<string, CharacterAuthoringState>, sceneObjects: Record<string, SceneObjectAuthoringState>) {
  const lookAtM = cameraTargetPosition(camera.lookAt, characters, sceneObjects);
  const followM = cameraTargetPosition(camera.follow, characters, sceneObjects);
  const positionM = cameraRuntimePosition(camera, followM);
  const subjectPositions = camera.subjectTargetIds.flatMap((targetId) => { const position = stateTargetPosition(targetId, characters, sceneObjects); return position ? [position] : []; });
  const subjectTargetM = subjectPositions.length ? subjectPositions.reduce((sum, value) => [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]] as Vector3, [0, 0, 0]).map((value) => value / subjectPositions.length) as Vector3 : null;
  const targetM = lookAtM ?? followM ?? subjectTargetM ?? cameraForwardTarget({ ...camera, transform: { ...camera.transform, position: positionM } });
  return { positionM, targetM, lookAtM, followM };
}

export function activeCameraAtFrame(trackId: string | null, tracks: TimelineTrackState[], frame: number, fps: number, fallbackCameraId: string): string {
  const track = tracks.find((item) => item.trackId === trackId && item.trackKind === "active_camera");
  const value = track ? evaluateKeyframes(track.keyframes, Math.max(0, frame - 1) / fps) : undefined;
  return typeof value === "string" ? value : fallbackCameraId;
}

function vector3(value: unknown): Vector3 | null {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item)) ? [...value] as Vector3 : null;
}

export function evaluateDirectorFrame(input: {
  frame: number;
  durationSeconds: number;
  fps: number;
  tracks: TimelineTrackState[];
  activeCameraTrackId: string | null;
  selectedCameraId: string;
  characters: Record<string, CharacterAuthoringState>;
  cameras: Record<string, CameraCompositionState>;
  sceneObjects: Record<string, SceneObjectAuthoringState>;
  actorPaths: Record<string, ActorPathState>;
  cameraPaths: Record<string, CameraPathState>;
}): EvaluatedDirectorFrame {
  const timeSeconds = frameTimeSeconds(input.frame, input.fps, input.durationSeconds);
  const characters = structuredClone(input.characters); const cameras = structuredClone(input.cameras); const sceneObjects = structuredClone(input.sceneObjects);
  const pathProgress = new Map<string, number>();
  // Paths provide the base spatial motion. Explicit transform tracks are
  // applied after them so imported/local animation keyframes remain visible
  // instead of being silently overwritten by a default actor path.
  for (const track of input.tracks) {
    if (track.trackKind !== "actor_path_progress" && track.trackKind !== "camera_path_progress") continue;
    const value = evaluateKeyframes(track.keyframes, timeSeconds);
    if (typeof value === "number") pathProgress.set(track.target.targetId, clamp01(value));
  }
  for (const path of Object.values(input.actorPaths)) if (characters[path.targetId]) characters[path.targetId].transform.position = evaluatePathPosition(path, timeSeconds, pathProgress.get(path.pathId));
  for (const path of Object.values(input.cameraPaths)) if (cameras[path.targetId]) cameras[path.targetId].transform.position = evaluatePathPosition(path, timeSeconds, pathProgress.get(path.pathId));
  for (const track of input.tracks) {
    const value = evaluateKeyframes(track.keyframes, timeSeconds);
    if (value === undefined) continue;
    if ((track.trackKind === "actor_path_progress" || track.trackKind === "camera_path_progress") && typeof value === "number") pathProgress.set(track.target.targetId, clamp01(value));
    if (track.trackKind === "character_transform" && characters[track.target.targetId]) {
      const target = characters[track.target.targetId]; const direct = vector3(value); const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const position = direct ?? vector3(record.position_m); const rotationDeg = vector3(record.rotation_deg); const scale = vector3(record.scale);
      target.transform = { ...target.transform, ...(position ? { position } : {}), ...(rotationDeg ? { rotationDeg } : {}), ...(scale ? { scale } : {}) };
    }
    if (track.trackKind === "character_pose" && characters[track.target.targetId] && value && typeof value === "object" && !Array.isArray(value)) characters[track.target.targetId].jointRotations = Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([jointId, rotation]) => {
      const vector = vector3(rotation); return vector ? [[jointId, { x: vector[0], y: vector[1], z: vector[2] }]] : [];
    }));
    if (track.trackKind === "camera_transform" && cameras[track.target.targetId]) {
      const target = cameras[track.target.targetId]; const direct = vector3(value); const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const position = direct ?? vector3(record.position_m); const rotationDeg = vector3(record.rotation_deg);
      target.transform = { ...target.transform, ...(position ? { position } : {}), ...(rotationDeg ? { rotationDeg } : {}) };
    }
    if (track.trackKind === "camera_fov" && cameras[track.target.targetId] && typeof value === "number") cameras[track.target.targetId].fovDeg = Math.min(140, Math.max(10, value));
    if (track.trackKind === "camera_target" && cameras[track.target.targetId]) {
      const target = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      cameras[track.target.targetId].lookAt = target && ["character", "scene_object", "world_point"].includes(String(target.target_type)) && typeof target.target_id === "string" ? { targetType: target.target_type as NonNullable<CameraCompositionState["lookAt"]>["targetType"], targetId: target.target_id } : null;
    }
    if (track.trackKind === "object_visibility" && sceneObjects[track.target.targetId] && typeof value === "boolean") sceneObjects[track.target.targetId].visible = value;
  }
  for (const camera of Object.values(cameras)) camera.focalLengthMm = cameraProjection(camera.fovDeg, camera.zoom, camera.aspectRatio).focalLengthMm;
  const requestedCameraId = activeCameraAtFrame(input.activeCameraTrackId, input.tracks, input.frame, input.fps, input.selectedCameraId);
  const activeCameraId = cameras[requestedCameraId] ? requestedCameraId : cameras[input.selectedCameraId] ? input.selectedCameraId : Object.keys(cameras)[0] ?? requestedCameraId;
  const activeCamera = cameras[activeCameraId]; const runtime = activeCamera ? cameraRuntime(activeCamera, characters, sceneObjects) : null;
  return { timeSeconds, activeCameraId, characters, cameras, sceneObjects, activeCameraProjection: activeCamera ? cameraProjection(activeCamera.fovDeg, activeCamera.zoom, activeCamera.aspectRatio) : null, activeCameraPositionM: runtime?.positionM ?? null, activeCameraTargetM: runtime?.targetM ?? null };
}
