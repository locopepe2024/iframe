import type {
  MotionRetargetFrameResult,
  MotionRetargetMappingEntry,
  MotionRetargetMappingManifest,
  DirectorRigRestEvidence,
  MotionRetargetResult,
  MotionTrackFrame,
  MotionTrackManifest,
  MotionTrackQuaternion,
  MotionTrackVector3,
} from "../types";
import { cleanupRetargetFrames, type MotionCleanupOptions } from "./motion-cleanup";

const EPSILON = 1e-8;
export const MOTION_MAPPING_SCHEMA = "director-rig-mapping.v1" as const;

const RIG_SOURCE_PAIRS: Array<[string, string, string]> = [
  ["pelvis", "left_hip", "right_hip"],
  ["spine_lower", "left_hip", "left_shoulder"],
  ["spine_mid", "left_hip", "left_shoulder"],
  ["spine_chest", "left_hip", "left_shoulder"],
  ["upper_leg_l", "left_hip", "left_knee"],
  ["lower_leg_l", "left_knee", "left_ankle"],
  ["upper_leg_r", "right_hip", "right_knee"],
  ["lower_leg_r", "right_knee", "right_ankle"],
  ["foot_l", "left_heel", "left_foot_index"],
  ["toe_l", "left_heel", "left_foot_index"],
  ["foot_r", "right_heel", "right_foot_index"],
  ["toe_r", "right_heel", "right_foot_index"],
];

export function createRigMappingManifest(
  rigProfileId: string,
  coordinateSystem: MotionRetargetMappingManifest["coordinateSystem"],
): MotionRetargetMappingManifest {
  const defaults: Array<[string, string, string, MotionTrackVector3]> = [
    ["pelvis", "left_hip", "right_hip", [1, 0, 0]],
    ["upper_leg_l", "left_hip", "left_knee", [0, -1, 0]],
    ["lower_leg_l", "left_knee", "left_ankle", [0, -1, 0]],
    ["upper_leg_r", "right_hip", "right_knee", [0, -1, 0]],
    ["lower_leg_r", "right_knee", "right_ankle", [0, -1, 0]],
    ["foot_l", "left_heel", "left_foot_index", [0, 0, 1]],
    ["toe_l", "left_heel", "left_foot_index", [0, 0, 1]],
    ["foot_r", "right_heel", "right_foot_index", [0, 0, 1]],
    ["toe_r", "right_heel", "right_foot_index", [0, 0, 1]],
  ];
  const entries: MotionRetargetMappingEntry[] = defaults.map(([targetJointId, sourceStartJoint, sourceEndJoint, restDirection]) => ({
    targetJointId,
    sourceStartJoint,
    sourceEndJoint,
    restDirection: restDirection as MotionTrackVector3,
    restQuaternion: [0, 0, 0, 1],
  }));
  return {
    schema: MOTION_MAPPING_SCHEMA,
    revision: "director-humanoid-motion-map.v1",
    rigProfileId,
    coordinateSystem,
    entries,
  };
}

export function createRigMappingManifestFromRestEvidence(
  evidence: DirectorRigRestEvidence,
  coordinateSystem: MotionRetargetMappingManifest["coordinateSystem"],
): MotionRetargetMappingManifest {
  if (evidence.schema !== "director-rig-rest-evidence.v1" || evidence.quaternionOrder !== "xyzw") {
    throw new Error("rig rest evidence schema 或 quaternion 顺序不受支持。");
  }
  const bones = new Map(evidence.bones.map((bone) => [bone.name, bone]));
  const entries = RIG_SOURCE_PAIRS.map(([targetJointId, sourceStartJoint, sourceEndJoint]) => {
    const bone = bones.get(targetJointId);
    if (!bone) throw new Error(`rig rest evidence 缺少骨骼 ${targetJointId}。`);
    return {
      targetJointId,
      sourceStartJoint,
      sourceEndJoint,
      restDirection: bone.directionArmature,
      restQuaternion: bone.restQuaternionArmatureXyzw,
    };
  });
  return {
    schema: MOTION_MAPPING_SCHEMA,
    revision: `director-${evidence.rigSha256.slice(0, 12)}-mapping-v2`,
    rigProfileId: evidence.rigAsset,
    coordinateSystem,
    entries,
  };
}

const dot = (a: MotionTrackVector3, b: MotionTrackVector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: MotionTrackVector3, b: MotionTrackVector3): MotionTrackVector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (value: MotionTrackVector3) => Math.sqrt(dot(value, value));
const normalize = (value: MotionTrackVector3): MotionTrackVector3 | null => {
  const size = length(value);
  return size > EPSILON ? [value[0] / size, value[1] / size, value[2] / size] : null;
};

function multiplyQuaternion(a: MotionTrackQuaternion, b: MotionTrackQuaternion): MotionTrackQuaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
function normalizeQuaternion(value: MotionTrackQuaternion): MotionTrackQuaternion {
  const size = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
  if (size <= EPSILON) return [0, 0, 0, 1];
  return value.map((item) => item / size) as MotionTrackQuaternion;
}

function quaternionFromDirection(from: MotionTrackVector3, to: MotionTrackVector3): MotionTrackQuaternion {
  const source = normalize(from) ?? [0, 0, 1];
  const target = normalize(to) ?? [0, 0, 1];
  const product = dot(source, target);
  if (product >= 1 - EPSILON) return [0, 0, 0, 1];
  if (product <= -1 + EPSILON) {
    const basis: MotionTrackVector3 = Math.abs(source[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const axis = normalize(cross(source, basis)) ?? [0, 0, 1];
    return [axis[0], axis[1], axis[2], 0];
  }
  const axis = cross(source, target);
  return normalizeQuaternion([axis[0], axis[1], axis[2], 1 + product]);
}

function currentDirection(frame: MotionTrackFrame, startJoint: string, endJoint: string): MotionTrackVector3 | null {
  const start = frame.semanticJoints[startJoint];
  const end = frame.semanticJoints[endJoint];
  if (!start || !end) return null;
  return [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
}

function keepQuaternionSign(quaternion: MotionTrackQuaternion, previous: MotionTrackQuaternion | undefined): MotionTrackQuaternion {
  if (!previous) return quaternion;
  const product = quaternion[0] * previous[0] + quaternion[1] * previous[1] + quaternion[2] * previous[2] + quaternion[3] * previous[3];
  return product < 0 ? quaternion.map((value) => -value) as MotionTrackQuaternion : quaternion;
}

export function retargetMotionTrack(
  manifest: MotionTrackManifest,
  mapping: MotionRetargetMappingManifest,
): MotionRetargetResult {
  if (mapping.schema !== MOTION_MAPPING_SCHEMA
    || mapping.coordinateSystem.image_x !== manifest.coordinateSystem.image_x
    || mapping.coordinateSystem.image_y !== manifest.coordinateSystem.image_y
    || mapping.coordinateSystem.depth_z !== manifest.coordinateSystem.depth_z) {
    throw new Error("motion track 与 rig mapping 的坐标系或 schema 不一致。");
  }
  const frames: MotionRetargetFrameResult[] = [];
  for (let frameIndex = 0; frameIndex < manifest.frames.length; frameIndex += 1) {
    const frame = manifest.frames[frameIndex];
    const result: MotionRetargetFrameResult = {
      frame: frame.frame,
      rootPosition: frame.rootPosition ? [...frame.rootPosition] as MotionTrackVector3 : null,
      pelvisQuaternion: null,
      localQuaternions: {},
      warnings: [],
    };
    if (frame.selectionStatus !== "tracked" && frame.selectionStatus !== "interpolated") {
      result.warnings.push(`frame ${frame.frame}: selection status ${frame.selectionStatus}; no pose was fabricated`);
      frames.push(result);
      continue;
    }
    const previous = frames[frameIndex - 1];
    for (const entry of mapping.entries) {
      const direction = currentDirection(frame, entry.sourceStartJoint, entry.sourceEndJoint);
      if (!direction || !normalize(direction)) {
        result.warnings.push(`frame ${frame.frame}: missing or zero direction for ${entry.targetJointId}`);
        continue;
      }
      const delta = quaternionFromDirection(entry.restDirection, direction);
      const rawQuaternion = normalizeQuaternion(multiplyQuaternion(entry.restQuaternion, delta));
      if (entry.targetJointId === "pelvis") {
        result.pelvisQuaternion = keepQuaternionSign(rawQuaternion, previous?.pelvisQuaternion ?? undefined);
      } else {
        result.localQuaternions[entry.targetJointId] = keepQuaternionSign(rawQuaternion, previous?.localQuaternions[entry.targetJointId]);
      }
    }
    frames.push(result);
  }
  const warnings = frames.flatMap((frame) => frame.warnings);
  return { mappingRevision: mapping.revision, mode: "local_quaternion_v1", frames, warnings };
}

export function retargetAndCleanupMotionTrack(
  manifest: MotionTrackManifest,
  mapping: MotionRetargetMappingManifest,
  options?: MotionCleanupOptions,
): MotionRetargetResult {
  const result = retargetMotionTrack(manifest, mapping);
  const cleaned = cleanupRetargetFrames(result.frames, options);
  return {
    ...result,
    frames: cleaned.frames,
    warnings: [...result.warnings, ...cleaned.warnings],
    cleanupProcessors: cleaned.processors,
  };
}
