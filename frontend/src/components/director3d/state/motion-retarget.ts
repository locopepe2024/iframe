import type { MotionRetargetFrameResult, MotionRetargetMappingEntry, MotionRetargetMappingManifest, MotionRetargetResult, MotionTrackCoordinateSystem, MotionTrackFrame, MotionTrackManifest, MotionTrackQuaternion, MotionTrackVector3 } from "../types";

export const MOTION_MAPPING_SCHEMA = "director-rig-mapping.v1" as const;
const ZERO: MotionTrackVector3 = [0, 0, 0];
const UP: MotionTrackVector3 = [0, 1, 0];

const MAP: Array<[string, string, string, MotionTrackVector3]> = [
  ["upper_leg_l", "left_hip", "left_knee", [0, -1, 0]], ["lower_leg_l", "left_knee", "left_ankle", [0, -1, 0]],
  ["upper_leg_r", "right_hip", "right_knee", [0, -1, 0]], ["lower_leg_r", "right_knee", "right_ankle", [0, -1, 0]],
  ["foot_l", "left_heel", "left_foot_index", [0, 1, 0]], ["toe_l", "left_heel", "left_foot_index", [0, 1, 0]],
  ["foot_r", "right_heel", "right_foot_index", [0, 1, 0]], ["toe_r", "right_heel", "right_foot_index", [0, 1, 0]],
];

export function createRigMappingManifest(rigProfileId: string, coordinateSystem: MotionTrackCoordinateSystem): MotionRetargetMappingManifest {
  const entries: MotionRetargetMappingEntry[] = MAP.map(([targetJointId, sourceStartJoint, sourceEndJoint, restDirection]) => ({ targetJointId, sourceStartJoint, sourceEndJoint, restDirection, restQuaternion: [0, 0, 0, 1] }));
  return { schema: MOTION_MAPPING_SCHEMA, revision: "director-humanoid-motion-map.v1", rigProfileId, coordinateSystem, entries };
}

function length(v: MotionTrackVector3): number { return Math.hypot(v[0], v[1], v[2]); }
function normalize(v: MotionTrackVector3): MotionTrackVector3 { const n = length(v); return n < 1e-8 ? [...ZERO] : [v[0] / n, v[1] / n, v[2] / n]; }
function sub(a: MotionTrackVector3, b: MotionTrackVector3): MotionTrackVector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a: MotionTrackVector3, b: MotionTrackVector3): MotionTrackVector3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a: MotionTrackVector3, s: number): MotionTrackVector3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a: MotionTrackVector3, b: MotionTrackVector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: MotionTrackVector3, b: MotionTrackVector3): MotionTrackVector3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

function rotationBetween(from: MotionTrackVector3, to: MotionTrackVector3): MotionTrackQuaternion | null {
  const a = normalize(from); const b = normalize(to); if (length(a) < 1e-8 || length(b) < 1e-8) return null;
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (d > 1 - 1e-7) return [0, 0, 0, 1];
  if (d < -1 + 1e-7) { const axis = length(cross(a, [1, 0, 0])) > 1e-5 ? normalize(cross(a, [1, 0, 0])) : normalize(cross(a, [0, 1, 0])); return [axis[0], axis[1], axis[2], 0]; }
  const axis = cross(a, b); const s = Math.sqrt((1 + d) * 2); return [axis[0] / s, axis[1] / s, axis[2] / s, s / 2];
}

function multiply(a: MotionTrackQuaternion, b: MotionTrackQuaternion): MotionTrackQuaternion {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

function resolveDirection(frame: MotionTrackFrame, entry: MotionRetargetMappingEntry): MotionTrackVector3 | null {
  const start = frame.semanticJoints[entry.sourceStartJoint]; const end = frame.semanticJoints[entry.sourceEndJoint];
  return start && end ? sub(end, start) : null;
}

function pelvisQuaternion(frame: MotionTrackFrame): MotionTrackQuaternion | null {
  const left = frame.semanticJoints.left_hip; const right = frame.semanticJoints.right_hip;
  if (!left || !right) return null;
  const across = normalize(sub(right, left));
  const forward = normalize(cross(across, UP));
  return rotationBetween([0, 0, 1], forward);
}

function retargetFrame(frame: MotionTrackFrame, mapping: MotionRetargetMappingManifest, previous: MotionRetargetFrameResult | null): MotionRetargetFrameResult {
  const localQuaternions: Record<string, MotionTrackQuaternion> = {}; const warnings: string[] = [];
  for (const entry of mapping.entries) {
    const direction = resolveDirection(frame, entry); const delta = direction ? rotationBetween(entry.restDirection, direction) : null;
    if (!delta) { warnings.push(`${entry.targetJointId}: source direction unavailable`); continue; }
    const quaternion = multiply(entry.restQuaternion, delta); const prior = previous?.localQuaternions[entry.targetJointId];
    localQuaternions[entry.targetJointId] = prior && prior[0] * quaternion[0] + prior[1] * quaternion[1] + prior[2] * quaternion[2] + prior[3] * quaternion[3] < 0 ? quaternion.map((v) => -v) as MotionTrackQuaternion : quaternion;
  }
  const pelvis = pelvisQuaternion(frame); if (!pelvis) warnings.push("pelvis: both hip points unavailable");
  return { frame: frame.frame, rootPosition: frame.rootPosition, pelvisQuaternion: pelvis, localQuaternions, warnings };
}

export function retargetMotionTrack(track: MotionTrackManifest, mapping: MotionRetargetMappingManifest): MotionRetargetResult {
  if (mapping.coordinateSystem.image_x !== track.coordinateSystem.image_x || mapping.coordinateSystem.image_y !== track.coordinateSystem.image_y || mapping.coordinateSystem.depth_z !== track.coordinateSystem.depth_z) throw new Error("motion track 与 rig mapping 的坐标系不一致。");
  const frames: MotionRetargetFrameResult[] = []; for (const frame of track.frames) frames.push(retargetFrame(frame, mapping, frames.at(-1) ?? null));
  return { mappingRevision: mapping.revision, mode: "local_quaternion_v1", frames, warnings: ["结果是局部 quaternion 候选；未执行 IK、限制裁剪或 Blender 写入。"] };
}
