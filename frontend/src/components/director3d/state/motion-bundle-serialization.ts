import type {
  MotionFullBundle,
  MotionRetargetManifest,
  MotionRetargetMappingManifest,
  MotionRetargetResult,
  MotionTrackManifest,
} from "../types";

export function buildRetargetManifest(
  source: MotionTrackManifest,
  mapping: MotionRetargetMappingManifest,
  result: MotionRetargetResult,
): MotionRetargetManifest {
  return {
    schema: "retarget_manifest.v1",
    source: { trackId: source.trackId, sourceRevision: source.sourceRevision, frameCount: result.frames.length },
    rig: { profileId: mapping.rigProfileId, mappingRevision: result.mappingRevision, coordinateSystem: { ...mapping.coordinateSystem } },
    mode: "local_quaternion_v1",
    frames: result.frames.map((frame) => ({
      frame: frame.frame,
      rootPosition: frame.rootPosition ? [...frame.rootPosition] as typeof frame.rootPosition : null,
      pelvisQuaternion: frame.pelvisQuaternion ? [...frame.pelvisQuaternion] as typeof frame.pelvisQuaternion : null,
      localJointIds: Object.keys(frame.localQuaternions).sort(),
      warnings: [...frame.warnings],
    })),
    warnings: [...result.warnings],
  };
}

export function serializeFullMotionBundle(bundle: MotionFullBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function serializeRetargetManifest(manifest: MotionRetargetManifest): string {
  return JSON.stringify(manifest, null, 2);
}
