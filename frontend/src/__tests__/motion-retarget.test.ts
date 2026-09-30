import { describe, expect, it } from "vitest";
import { createRigMappingManifest, retargetMotionTrack } from "../components/director3d/state/motion-retarget";
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
