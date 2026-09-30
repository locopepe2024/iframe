import { describe, expect, it } from "vitest";

import { createRigMappingManifest, retargetMotionTrack } from "../components/director3d/state/motion-retarget";
import type { MotionTrackManifest } from "../components/director3d/types";

const coordinateSystem = { image_x: "blender_x" as const, image_y: "blender_z" as const, depth_z: "blender_y" as const };
const track: MotionTrackManifest = {
  schema: "motion-track.v1", trackId: "t", coordinateSystem, sourceRevision: "r1", frames: [{
    frame: 1, sourceFrame: 1, sourceTimestampSeconds: 0, selectionStatus: "tracked", rootPosition: [2, 0, 0],
    semanticJoints: { left_hip: [-1, 1, 0], right_hip: [1, 1, 0], left_knee: [-1, 0, 0], right_knee: [1, 0, 0], left_ankle: [-1, -1, 0], right_ankle: [1, -1, 0], left_heel: [-1, -1, 0], right_heel: [1, -1, 0], left_foot_index: [-1, -1, 1], right_foot_index: [1, -1, 1] },
    jointConfidence: {}, footTargets: { left: { ankle: null, heel: null, toe: null }, right: { ankle: null, heel: null, toe: null } }, footContactCandidates: { left: { candidate: false, confidence: 0 }, right: { candidate: false, confidence: 0 } },
  }],
};

describe("motion retarget", () => {
  it("keeps root translation separate and emits limb/pelvis quaternions", () => {
    const result = retargetMotionTrack(track, createRigMappingManifest("rig-director-humanoid-full-v1", coordinateSystem));
    expect(result.mode).toBe("local_quaternion_v1");
    expect(result.frames[0].rootPosition).toEqual([2, 0, 0]);
    expect(result.frames[0].localQuaternions.upper_leg_l).toHaveLength(4);
    expect(result.frames[0].pelvisQuaternion).toHaveLength(4);
  });
  it("marks missing source directions without fabricating rotations", () => {
    const partial = { ...track, frames: [{ ...track.frames[0], semanticJoints: {} }] };
    const result = retargetMotionTrack(partial, createRigMappingManifest("rig-director-humanoid-full-v1", coordinateSystem));
    expect(result.frames[0].localQuaternions).toEqual({});
    expect(result.frames[0].warnings.length).toBeGreaterThan(0);
  });
});
