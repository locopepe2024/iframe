import { describe, expect, it } from "vitest";
import { buildFullMotionBundle } from "../components/director3d/state/motion-pipeline";
import { buildRetargetManifest, serializeFullMotionBundle, serializeRetargetManifest } from "../components/director3d/state/motion-bundle-serialization";
import { createRigMappingManifest, retargetMotionTrack } from "../components/director3d/state/motion-retarget";
import type { MotionTrackManifest } from "../components/director3d/types";

const coordinateSystem = { image_x: "blender_x" as const, image_y: "blender_z" as const, depth_z: "blender_y" as const };
const source: MotionTrackManifest = {
  schema: "motion-track.v1", trackId: "serialization-track", sourceRevision: "source-r1", coordinateSystem,
  frames: [{ frame: 1, sourceFrame: 1, sourceTimestampSeconds: 0, selectionStatus: "tracked", rootPosition: [0, 0, 0],
    semanticJoints: { shoulder_l: [0, 0, 0], elbow_l: [0, 1, 0], hip_l: [0, 0, 0], hip_r: [1, 0, 0] }, jointConfidence: {},
    footTargets: { left: { ankle: null, heel: null, toe: null }, right: { ankle: null, heel: null, toe: null } },
    footContactCandidates: { left: { candidate: false, confidence: 0 }, right: { candidate: false, confidence: 0 } } }],
};
const mapping = {
  schema: "director-rig-mapping.v1" as const, revision: "map-r1", rigProfileId: "humanoid-v1", coordinateSystem,
  entries: [{ targetJointId: "upper_arm_l", sourceStartJoint: "shoulder_l", sourceEndJoint: "elbow_l", restDirection: [1, 0, 0] as [number, number, number], restQuaternion: [0, 0, 0, 1] as [number, number, number, number] }],
};

describe("motion bundle serialization", () => {
  it("serializes full bundle and retarget manifest as parseable versioned JSON", () => {
    const result = retargetMotionTrack(source, mapping);
    const bundle = buildFullMotionBundle(source, mapping);
    const retargetManifest = buildRetargetManifest(source, mapping, result);
    expect(JSON.parse(serializeFullMotionBundle(bundle)).schema).toBe("full_motion.bundle.v1");
    const parsed = JSON.parse(serializeRetargetManifest(retargetManifest));
    expect(parsed.schema).toBe("retarget_manifest.v1");
    expect(parsed.source.frameCount).toBe(1);
    expect(parsed.frames[0].localJointIds).toEqual(["upper_arm_l"]);
  });

  it("does not expose quaternion values in the compact retarget manifest", () => {
    const manifest = buildRetargetManifest(source, mapping, retargetMotionTrack(source, mapping));
    expect(manifest.frames[0]).not.toHaveProperty("localQuaternions");
  });
});
