import { describe, expect, it } from "vitest";
import { buildFullMotionBundle } from "../components/director3d/state/motion-pipeline";
import { createRigMappingManifest } from "../components/director3d/state/motion-retarget";
import type { MotionTrackManifest } from "../components/director3d/types";

const coordinateSystem = { image_x: "blender_x" as const, image_y: "blender_z" as const, depth_z: "blender_y" as const };

function manifest(): MotionTrackManifest {
  return {
    schema: "motion-track.v1", trackId: "track-pipeline", sourceRevision: "source-r1", coordinateSystem,
    frames: [1, 2, 3].map((frame) => ({
      frame, sourceFrame: frame, sourceTimestampSeconds: frame / 24, selectionStatus: "tracked" as const,
      rootPosition: [0, 0, 0] as [number, number, number],
      semanticJoints: {
        left_hip: [0, 1, 0], left_knee: [0, 0.5, 0], left_ankle: [0, 0, 0],
        right_hip: [1, 1, 0], right_knee: [1, 0.5, 0], right_ankle: [1, 0, 0],
      },
      jointConfidence: {},
      footTargets: {
        left: { ankle: [0, 0, 0], heel: null, toe: null },
        right: { ankle: [1, 0, 0], heel: null, toe: null },
      },
      footContactCandidates: {
        left: { candidate: true, confidence: 0.95 },
        right: { candidate: true, confidence: 0.95 },
      },
    })),
  };
}

describe("director 3d motion pipeline", () => {
  it("produces a reviewable full motion bundle without renderer output", () => {
    const source = manifest();
    const result = buildFullMotionBundle(source, createRigMappingManifest("humanoid-v1", coordinateSystem));
    expect(result.schema).toBe("full_motion.bundle.v1");
    expect(result.frames).toHaveLength(3);
    expect(result.preview).toEqual({ status: "ready_for_white_model", renderer: null, artifactUrl: null });
    expect(result.frames.every((frame) => frame.ik.left === null && frame.ik.right === null)).toBe(true);
    expect(result.frames[0].footContacts.every((contact) => contact.reason === "ground_not_calibrated")).toBe(true);
  });

  it("does not mutate the imported track", () => {
    const source = manifest();
    const before = JSON.stringify(source);
    buildFullMotionBundle(source, createRigMappingManifest("humanoid-v1", coordinateSystem));
    expect(JSON.stringify(source)).toBe(before);
  });

  it("runs IK only after calibrated accepted contacts", () => {
    const source = manifest();
    const result = buildFullMotionBundle(source, createRigMappingManifest("humanoid-v1", coordinateSystem), {
      footContact: { groundHeightM: 0 },
      poleTargets: { left: [0, 0, 1], right: [1, 0, 1] },
    });
    expect(result.frames[1].footContacts.every((contact) => contact.status === "accepted")).toBe(true);
    expect(result.frames[1].ik.left?.status).toBe("accepted");
    expect(result.frames[1].ik.right?.status).toBe("accepted");
  });
});
