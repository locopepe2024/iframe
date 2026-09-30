import type { MotionTrackCoordinateSystem, MotionTrackFootContactCandidate, MotionTrackFootTarget, MotionTrackFrame, MotionTrackImportState, MotionTrackManifest, MotionTrackSelectionStatus, MotionTrackVector3 } from "../types";

export const MOTION_TRACK_SCHEMA = "motion-track.v1" as const;
export const MOTION_TRACK_MAX_BYTES = 16 * 1024 * 1024;
export const MOTION_TRACK_MAX_FRAMES = 120_000;

const SEMANTIC_JOINTS = new Set([
  "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
  "left_heel", "right_heel", "left_foot_index", "right_foot_index",
]);
const SELECTION_STATUSES = new Set<MotionTrackSelectionStatus>(["tracked", "interpolated", "occluded", "rejected", "unknown"]);

export function createIdleMotionTrackImportState(): MotionTrackImportState {
  return { status: "idle", fileName: null, manifest: null, errors: [], warnings: [], importedAt: null };
}

export function createMotionTrackImportErrorState(fileName: string | null, message: string): MotionTrackImportState {
  return { ...createIdleMotionTrackImportState(), status: "error", fileName, errors: [message] };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} 必须是对象。`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, field: string, minimum = -1e6, maximum = 1e6): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${field} 必须是有限数字。`);
  return value;
}

function optionalFinite(value: unknown, field: string, minimum = -1e6, maximum = 1e6): number | null {
  return value === null || value === undefined ? null : finite(value, field, minimum, maximum);
}

function vector3(value: unknown, field: string, nullable = false): MotionTrackVector3 | null {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new Error(`${field} 必须是 [x,y,z]。`);
  }
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${field} 必须是 [x,y,z]。`);
  return [finite(value[0], `${field}[0]`), finite(value[1], `${field}[1]`), finite(value[2], `${field}[2]`)] as MotionTrackVector3;
}

function confidence(value: unknown, field: string): number {
  return finite(value, field, 0, 1);
}

function footTarget(value: unknown, field: string): MotionTrackFootTarget {
  const source = value === undefined || value === null ? {} : record(value, field);
  return {
    ankle: vector3(source.ankle, `${field}.ankle`, true),
    heel: vector3(source.heel, `${field}.heel`, true),
    toe: vector3(source.toe, `${field}.toe`, true),
  };
}

function footCandidate(value: unknown, field: string): MotionTrackFootContactCandidate {
  const source = record(value ?? {}, field);
  if (typeof source.candidate !== "boolean") throw new Error(`${field}.candidate 必须是布尔值。`);
  return { candidate: source.candidate, confidence: confidence(source.confidence ?? 0, `${field}.confidence`) };
}

function parseFrame(value: unknown, index: number): MotionTrackFrame {
  const source = record(value, `frames[${index}]`);
  const frame = finite(source.frame, `frames[${index}].frame`, 1, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(frame)) throw new Error(`frames[${index}].frame 必须是整数。`);
  const status = source.selection_status ?? source.selectionStatus ?? "unknown";
  if (typeof status !== "string" || !SELECTION_STATUSES.has(status as MotionTrackSelectionStatus)) throw new Error(`frames[${index}].selection_status 不受支持。`);
  const rawJoints = record(source.semantic_joints ?? source.semanticJoints ?? {}, `frames[${index}].semantic_joints`);
  const semanticJoints: Record<string, MotionTrackVector3> = {};
  for (const [joint, value] of Object.entries(rawJoints)) {
    if (!SEMANTIC_JOINTS.has(joint)) continue;
    const parsed = vector3(value, `frames[${index}].semantic_joints.${joint}`);
    if (parsed) semanticJoints[joint] = parsed;
  }
  const rawConfidence = record(source.joint_confidence ?? source.jointConfidence ?? {}, `frames[${index}].joint_confidence`);
  const jointConfidence: Record<string, number> = {};
  for (const [joint, value] of Object.entries(rawConfidence)) {
    if (SEMANTIC_JOINTS.has(joint)) jointConfidence[joint] = confidence(value, `frames[${index}].joint_confidence.${joint}`);
  }
  const targets = record(source.foot_targets ?? source.footTargets ?? {}, `frames[${index}].foot_targets`);
  const contacts = record(source.foot_contact_candidates ?? source.footContactCandidates ?? {}, `frames[${index}].foot_contact_candidates`);
  return {
    frame,
    sourceFrame: source.source_frame === undefined ? (source.sourceFrame === undefined ? null : finite(source.sourceFrame, `frames[${index}].sourceFrame`, 0, Number.MAX_SAFE_INTEGER)) : finite(source.source_frame, `frames[${index}].source_frame`, 0, Number.MAX_SAFE_INTEGER),
    sourceTimestampSeconds: optionalFinite(source.source_timestamp_seconds ?? source.sourceTimestampSeconds, `frames[${index}].source_timestamp_seconds`, 0, 86400),
    selectionStatus: status as MotionTrackSelectionStatus,
    rootPosition: vector3(source.root_position ?? source.rootPosition, `frames[${index}].root_position`, true),
    semanticJoints,
    jointConfidence,
    footTargets: { left: footTarget(targets.left, `frames[${index}].foot_targets.left`), right: footTarget(targets.right, `frames[${index}].foot_targets.right`) },
    footContactCandidates: { left: footCandidate(contacts.left, `frames[${index}].foot_contact_candidates.left`), right: footCandidate(contacts.right, `frames[${index}].foot_contact_candidates.right`) },
  };
}

export function parseMotionTrackManifest(input: unknown, options: { fileName?: string } = {}): { ok: boolean; state: MotionTrackImportState } {
  try {
    const source = record(input, "根节点");
    if (source.schema !== MOTION_TRACK_SCHEMA && source.schema_version !== MOTION_TRACK_SCHEMA) throw new Error(`schema 必须为“${MOTION_TRACK_SCHEMA}”。`);
    const coordinate = record(source.coordinate_system ?? source.coordinateSystem, "coordinate_system") as Partial<MotionTrackCoordinateSystem>;
    if (coordinate.image_x !== "blender_x" || coordinate.image_y !== "blender_z" || coordinate.depth_z !== "blender_y") throw new Error("coordinate_system 必须明确声明 image_x/blender_x、image_y/blender_z、depth_z/blender_y。");
    if (!Array.isArray(source.frames) || source.frames.length < 1 || source.frames.length > MOTION_TRACK_MAX_FRAMES) throw new Error(`frames 必须包含 1–${MOTION_TRACK_MAX_FRAMES} 帧。`);
    const frames = source.frames.map(parseFrame);
    const seen = new Set<number>();
    for (const frame of frames) { if (seen.has(frame.frame)) throw new Error(`存在重复 frame ${frame.frame}。`); seen.add(frame.frame); }
    const trackId = typeof source.track_id === "string" ? source.track_id : typeof source.trackId === "string" ? source.trackId : "motion-track-import";
    const manifest: MotionTrackManifest = { schema: MOTION_TRACK_SCHEMA, trackId, coordinateSystem: coordinate as MotionTrackCoordinateSystem, frames, sourceRevision: typeof source.source_revision === "string" ? source.source_revision : null };
    const warnings = frames.some((frame) => Object.keys(frame.semanticJoints).length === 0) ? ["部分帧没有可用 semantic_joints；不会伪造关节位置。"] : [];
    return { ok: true, state: { status: "ready", fileName: options.fileName ?? null, manifest, errors: [], warnings, importedAt: new Date().toISOString() } };
  } catch (caught) {
    return { ok: false, state: createMotionTrackImportErrorState(options.fileName ?? null, caught instanceof Error ? caught.message : "motion-track.v1 无法验证。") };
  }
}
