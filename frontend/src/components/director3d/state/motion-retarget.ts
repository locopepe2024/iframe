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
export const IMAGE_TO_BLENDER_BASIS_QUATERNION: MotionTrackQuaternion = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
export const IMAGE_TO_BLENDER_BASIS_REVISION = "image_xy_depth_to_blender_xzy_neg_y_v1";

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

export function normalizeRigRestEvidence(input: unknown): DirectorRigRestEvidence {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("rig rest evidence 必须是对象。");
  const source = input as Record<string, unknown>;
  if (source.schema !== "director-rig-rest-evidence.v1") throw new Error("rig rest evidence schema 不受支持。");
  const bones = source.bones;
  if (!Array.isArray(bones)) throw new Error("rig rest evidence bones 必须是数组。");
  const vector = (value: unknown, field: string): MotionTrackVector3 => {
    if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new Error(`${field} 必须是有限三维向量。`);
    return value as MotionTrackVector3;
  };
  const quaternion = (value: unknown, field: string): MotionTrackQuaternion => {
    if (!Array.isArray(value) || value.length !== 4 || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new Error(`${field} 必须是有限四元数。`);
    return value as MotionTrackQuaternion;
  };
  return {
    schema: "director-rig-rest-evidence.v1",
    rigAsset: String(source.rigAsset ?? source.rig_asset ?? ""),
    rigSha256: String(source.rigSha256 ?? source.rig_sha256 ?? ""),
    blenderVersion: String(source.blenderVersion ?? source.blender_version ?? ""),
    armature: String(source.armature ?? ""),
    coordinateSpace: (source.coordinateSpace ?? source.coordinate_space) as DirectorRigRestEvidence["coordinateSpace"],
    quaternionOrder: (source.quaternionOrder ?? source.quaternion_order) as DirectorRigRestEvidence["quaternionOrder"],
    boneCount: Number(source.boneCount ?? source.bone_count ?? bones.length),
    bones: bones.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`bones[${index}] 必须是对象。`);
      const bone = item as Record<string, unknown>;
      return {
        name: String(bone.name ?? ""), parent: bone.parent === null || bone.parent === undefined ? null : String(bone.parent), deform: Boolean(bone.deform),
        headArmature: vector(bone.headArmature ?? bone.head_armature, `bones[${index}].head`), tailArmature: vector(bone.tailArmature ?? bone.tail_armature, `bones[${index}].tail`),
        directionArmature: vector(bone.directionArmature ?? bone.direction_armature, `bones[${index}].direction`), restQuaternionArmatureXyzw: quaternion(bone.restQuaternionArmatureXyzw ?? bone.rest_quaternion_armature_xyzw, `bones[${index}].restQuaternion`), lengthM: Number(bone.lengthM ?? bone.length_m),
      };
    }),
  };
}

export function createRigMappingManifest(
  rigProfileId: string,
  coordinateSystem: MotionRetargetMappingManifest["coordinateSystem"],
): MotionRetargetMappingManifest {
  const defaults: Array<[string, string, string, MotionTrackVector3]> = [
    ["pelvis", "left_hip", "right_hip", [1, 0, 0]],
    ["spine_lower", "hips", "shoulders", [0, 1, 0]],
    ["spine_mid", "hips", "shoulders", [0, 1, 0]],
    ["spine_chest", "hips", "shoulders", [0, 1, 0]],
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
    sourceBasisQuaternion: IMAGE_TO_BLENDER_BASIS_QUATERNION,
    sourceBasisRevision: IMAGE_TO_BLENDER_BASIS_REVISION,
    entries,
  };
}

export function createRigMappingManifestFromRestEvidence(
  input: DirectorRigRestEvidence | unknown,
  coordinateSystem: MotionRetargetMappingManifest["coordinateSystem"],
): MotionRetargetMappingManifest {
  const evidence = normalizeRigRestEvidence(input);
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
    sourceBasisQuaternion: IMAGE_TO_BLENDER_BASIS_QUATERNION,
    sourceBasisRevision: IMAGE_TO_BLENDER_BASIS_REVISION,
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

function rotateVector(quaternion: MotionTrackQuaternion, value: MotionTrackVector3): MotionTrackVector3 {
  const inverse: MotionTrackQuaternion = [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]];
  const vectorQuaternion: MotionTrackQuaternion = [value[0], value[1], value[2], 0];
  const rotated = multiplyQuaternion(multiplyQuaternion(quaternion, vectorQuaternion), inverse);
  return [rotated[0], rotated[1], rotated[2]];
}

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
function distributeQuaternion(value: MotionTrackQuaternion, fraction: number): MotionTrackQuaternion {
  const t = Math.max(0, Math.min(1, fraction));
  return normalizeQuaternion([value[0] * t, value[1] * t, value[2] * t, 1 + (value[3] - 1) * t]);
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
  if (startJoint === "hips" && endJoint === "shoulders") {
    if (frame.bodyCenters?.torsoDirection) return frame.bodyCenters.torsoDirection;
    const hips = frame.bodyCenters?.hips; const shoulders = frame.bodyCenters?.shoulders;
    if (hips && shoulders) return [shoulders[0] - hips[0], shoulders[1] - hips[1], shoulders[2] - hips[2]];
    return null;
  }
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
      const sourceDirection = mapping.sourceBasisQuaternion
        ? rotateVector(mapping.sourceBasisQuaternion, direction)
        : direction;
      const rawDelta = quaternionFromDirection(entry.restDirection, sourceDirection);
      const delta = entry.targetJointId.startsWith("spine_") ? distributeQuaternion(rawDelta, 1 / 3) : rawDelta;
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
