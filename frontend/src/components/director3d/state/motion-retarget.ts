import type {
  MotionRetargetFrameResult,
  MotionRetargetMappingManifest,
  MotionRetargetResult,
  MotionTrackFrame,
  MotionTrackManifest,
  MotionTrackQuaternion,
  MotionTrackVector3,
} from "../types";

const EPSILON = 1e-8;
export const MOTION_MAPPING_SCHEMA = "director-rig-mapping.v1" as const;

export function createRigMappingManifest(
  rigProfileId: string,
  coordinateSystem: MotionRetargetMappingManifest["coordinateSystem"],
): MotionRetargetMappingManifest {
  return {
    schema: MOTION_MAPPING_SCHEMA,
    revision: "director-humanoid-motion-map.v1",
    rigProfileId,
    coordinateSystem,
    entries: [],
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
  const frames: MotionRetargetFrameResult[] = manifest.frames.map((frame) => {
    const result: MotionRetargetFrameResult = {
      frame: frame.frame,
      rootPosition: frame.rootPosition ? [...frame.rootPosition] as MotionTrackVector3 : null,
      pelvisQuaternion: null,
      localQuaternions: {},
      warnings: [],
    };
    if (frame.selectionStatus === "occluded" || frame.selectionStatus === "rejected") {
      result.warnings.push(`frame ${frame.frame}: selection status ${frame.selectionStatus}; no pose was fabricated`);
      return result;
    }
    for (const entry of mapping.entries) {
      const direction = currentDirection(frame, entry.sourceStartJoint, entry.sourceEndJoint);
      if (!direction || !normalize(direction)) {
        result.warnings.push(`frame ${frame.frame}: missing or zero direction for ${entry.targetJointId}`);
        continue;
      }
      const delta = quaternionFromDirection(entry.restDirection, direction);
      const quaternion = normalizeQuaternion(multiplyQuaternion(entry.restQuaternion, delta));
      if (entry.targetJointId === "pelvis") result.pelvisQuaternion = quaternion;
      else result.localQuaternions[entry.targetJointId] = quaternion;
    }
    return result;
  });
  const warnings = frames.flatMap((frame) => frame.warnings);
  return { mappingRevision: mapping.revision, mode: "local_quaternion_v1", frames, warnings };
}
