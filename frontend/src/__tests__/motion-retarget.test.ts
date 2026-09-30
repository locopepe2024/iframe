import { describe, expect, it } from "vitest";
import { createRigMappingManifest, createRigMappingManifestFromRestEvidence, IMAGE_TO_BLENDER_BASIS_QUATERNION, IMAGE_TO_BLENDER_BASIS_REVISION, normalizeRigRestEvidence, retargetMotionTrack } from "../components/director3d/state/motion-retarget";
import type { MotionRetargetMappingManifest, MotionTrackManifest } from "../components/director3d/types";

const mapping: MotionRetargetMappingManifest = {
  schema: "director-rig-mapping.v1",
  revision: "mapping-1",
  rigProfileId: "humanoid-v1",
  coordinateSystem: { image_x: "blender_x", image_y: "blender_z", depth_z: "blender_y" },
  entries: [
    { targetJointId: "upper_arm_l", sourceStartJoint: "shoulder_l", sourceEndJoint: "elbow_l", restDirection: [1, 0, 0], restQuaternion: [0, 0, 0, 1] },
    { targetJointId: "pelvis", sourceStartJoint: "hip_l", sourceEndJoint: "hip_r", restDirection: [1, 0, 0], restQuaternion: [0, 0, 0, 1] },
  ],
};

const track = (status: "tracked" | "occluded" = "tracked"): MotionTrackManifest => ({
  schema: "motion-track.v1",
  trackId: "track-1",
  coordinateSystem: { image_x: "blender_x", image_y: "blender_z", depth_z: "blender_y" },
  sourceRevision: "source-1",
  frames: [{
    frame: 1, sourceFrame: 1, sourceTimestampSeconds: 0, selectionStatus: status,
    rootPosition: [2, 3, 4],
    semanticJoints: status === "occluded" ? {} : {
      shoulder_l: [0, 0, 0], elbow_l: [0, 1, 0], hip_l: [0, 0, 0], hip_r: [0, 1, 0],
    },
    jointConfidence: {},
    footTargets: { left: { ankle: null, heel: null, toe: null }, right: { ankle: null, heel: null, toe: null } },
    footContactCandidates: { left: { candidate: false, confidence: 0 }, right: { candidate: false, confidence: 0 } },
  }],
});
describe("motion-track local quaternion retarget", () => {
  it("binds calibrated mapping revision to rig evidence hash", () => {
    const names = ["pelvis", "spine_lower", "spine_mid", "spine_chest", "upper_leg_l", "lower_leg_l", "upper_leg_r", "lower_leg_r", "foot_l", "toe_l", "foot_r", "toe_r"];
    const evidence = {
      schema: "director-rig-rest-evidence.v1" as const,
      rigAsset: "white-model.blend", rigSha256: "abcdef1234567890", blenderVersion: "4.5.9", armature: "armature",
      coordinateSpace: "armature_local_rest" as const, quaternionOrder: "xyzw" as const, boneCount: names.length,
      bones: names.map((name) => ({ name, parent: null, deform: true, headArmature: [0, 0, 0] as [number, number, number], tailArmature: [0, 0, 1] as [number, number, number], directionArmature: [0, 0, 1] as [number, number, number], restQuaternionArmatureXyzw: [0, 0, 0, 1] as [number, number, number, number], lengthM: 1 })),
    };
    const calibrated = createRigMappingManifestFromRestEvidence(evidence, mapping.coordinateSystem);
    expect(calibrated.revision).toBe("director-abcdef123456-mapping-v2");
    expect(calibrated.entries.find((entry) => entry.targetJointId === "foot_l")?.restDirection).toEqual([0, 0, 1]);
    expect(calibrated.sourceBasisRevision).toBe(IMAGE_TO_BLENDER_BASIS_REVISION);
    expect(calibrated.sourceBasisQuaternion).toEqual(IMAGE_TO_BLENDER_BASIS_QUATERNION);
  });
  it("maps image y down to Blender z up", () => {
    const source = track();
    source.frames[0].semanticJoints = { shoulder_l: [0, 0, 0], elbow_l: [0, 1, 0] };
    const result = retargetMotionTrack(source, { ...mapping, sourceBasisQuaternion: IMAGE_TO_BLENDER_BASIS_QUATERNION, sourceBasisRevision: IMAGE_TO_BLENDER_BASIS_REVISION });
    const q = result.frames[0].localQuaternions.upper_arm_l;
    expect(q).toBeDefined();
    expect(q![1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(q![3]).toBeCloseTo(Math.SQRT1_2, 5);
  });
  it("normalizes the Blender snake_case evidence export", () => {
    const normalized = normalizeRigRestEvidence({ schema: "director-rig-rest-evidence.v1", rig_asset: "a.blend", rig_sha256: "hash", blender_version: "4.5.9", armature: "a", coordinate_space: "armature_local_rest", quaternion_order: "xyzw", bone_count: 1, bones: [{ name: "pelvis", parent: null, deform: true, head_armature: [0, 0, 0], tail_armature: [0, 0, 1], direction_armature: [0, 0, 1], rest_quaternion_armature_xyzw: [0, 0, 0, 1], length_m: 1 }] });
    expect(normalized.rigAsset).toBe("a.blend");
    expect(normalized.bones[0].directionArmature).toEqual([0, 0, 1]);
  });
  it("keeps root separate and maps a quarter turn direction", () => {
    const result = retargetMotionTrack(track(), mapping);
    const frame = result.frames[0];
    expect(frame.rootPosition).toEqual([2, 3, 4]);
    expect(frame.localQuaternions.upper_arm_l?.[3]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(frame.pelvisQuaternion?.[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("does not fabricate pose for an occluded frame", () => {
    const result = retargetMotionTrack(track("occluded"), mapping);
    expect(result.frames[0].rootPosition).toEqual([2, 3, 4]);
    expect(result.frames[0].localQuaternions).toEqual({});
    expect(result.frames[0].pelvisQuaternion).toBeNull();
    expect(result.warnings[0]).toContain("no pose was fabricated");
  });

  it("rejects a mapping with a different coordinate system", () => {
    expect(() => retargetMotionTrack(track(), {
      ...mapping,
      coordinateSystem: { image_x: "blender_x", image_y: "blender_y", depth_z: "blender_z" } as never,
    })).toThrow("坐标系");
  });

  it("creates the default hip-knee-ankle and foot mappings", () => {
    const manifest = createRigMappingManifest("humanoid-v1", track().coordinateSystem);
    expect(manifest.entries.map((entry) => entry.targetJointId)).toEqual([
      "pelvis", "upper_leg_l", "lower_leg_l", "upper_leg_r", "lower_leg_r", "foot_l", "toe_l", "foot_r", "toe_r",
    ]);
    const result = retargetMotionTrack({
      ...track(),
      frames: [{ ...track().frames[0], semanticJoints: {
        left_hip: [-1, 1, 0], right_hip: [1, 1, 0], left_knee: [-1, 0, 0], right_knee: [1, 0, 0],
        left_ankle: [-1, -1, 0], right_ankle: [1, -1, 0], left_heel: [-1, -1, 0], right_heel: [1, -1, 0],
        left_foot_index: [-1, -1, 1], right_foot_index: [1, -1, 1],
      }}],
    }, manifest);
    expect(result.frames[0].localQuaternions.upper_leg_l).toHaveLength(4);
    expect(result.frames[0].localQuaternions.foot_r).toHaveLength(4);
    expect(result.frames[0].pelvisQuaternion).toHaveLength(4);
  });

  it("keeps adjacent quaternion signs continuous", () => {
    const twoFrames = {
      ...track(),
      frames: [track().frames[0], { ...track().frames[0], frame: 2, sourceFrame: 2, sourceTimestampSeconds: 1 }],
    };
    const result = retargetMotionTrack(twoFrames, mapping);
    const first = result.frames[0].localQuaternions.upper_arm_l!;
    const second = result.frames[1].localQuaternions.upper_arm_l!;
    expect(first[0] * second[0] + first[1] * second[1] + first[2] * second[2] + first[3] * second[3]).toBeGreaterThanOrEqual(0);
  });

  it("warns and skips only the mapping whose source joint is missing", () => {
    const result = retargetMotionTrack({ ...track(), frames: [{ ...track().frames[0], semanticJoints: { shoulder_l: [0, 0, 0], elbow_l: [0, 1, 0], hip_l: [0, 0, 0] } }] }, mapping);
    expect(result.frames[0].localQuaternions.upper_arm_l).toHaveLength(4);
    expect(result.frames[0].pelvisQuaternion).toBeNull();
    expect(result.frames[0].warnings.some((warning) => warning.includes("pelvis"))).toBe(true);
  });
});
