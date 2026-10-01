import { describe, expect, it } from "vitest";

import { parseMotionTrackManifest } from "../components/director3d/state/motion-track-import";

const frame = {
  frame: 1,
  source_frame: 4,
  source_timestamp_seconds: 0.1,
  selection_status: "tracked",
  root_position: [0, 0, 0],
  semantic_joints: { left_ankle: [1, 2, 3], right_ankle: [4, 5, 6] },
  joint_confidence: { left_ankle: 0.9, right_ankle: 0.8 },
  foot_targets: { left: { ankle: [1, 2, 3], heel: null, toe: [1, 2, 4] }, right: { ankle: [4, 5, 6], heel: null, toe: [4, 5, 7] } },
  foot_contact_candidates: { left: { candidate: true, confidence: 0.8 }, right: { candidate: false, confidence: 0.2 } },
};

describe("motion-track.v1 import", () => {
  it("requires the declared coordinate mapping and preserves evidence", () => {
    const result = parseMotionTrackManifest({ schema: "motion-track.v1", track_id: "track-1", coordinate_system: { image_x: "blender_x", image_y: "blender_z", depth_z: "blender_y" }, frames: [frame] }, { fileName: "track.json" });
    expect(result.ok).toBe(true);
    expect(result.state.manifest?.frames[0].footContactCandidates.left.candidate).toBe(true);
    expect(result.state.manifest?.frames[0].semanticJoints.left_ankle).toEqual([1, 2, 3]);
  });

  it("rejects an undeclared or guessed coordinate system", () => {
    const result = parseMotionTrackManifest({ schema: "motion-track.v1", coordinate_system: { image_x: "x", image_y: "z", depth_z: "y" }, frames: [frame] });
    expect(result.ok).toBe(false);
    expect(result.state.errors[0]).toContain("coordinate_system");
  });
  it("preserves target misses without claiming occlusion", () => {
    const result = parseMotionTrackManifest({ schema: "motion-track.v1", coordinate_system: { image_x: "blender_x", image_y: "blender_z", depth_z: "blender_y" }, frames: [{ ...frame, selection_status: "detector_missed", selection_reason: "identity_unresolved", occlusion_evidence: false }, { ...frame, frame: 2, selection_status: "out_of_frame", selection_reason: "no_candidate_pose", occlusion_evidence: false }] });
    expect(result.ok).toBe(true);
    expect(result.state.manifest?.frames.map((item) => [item.selectionStatus, item.selectionReason, item.occlusionEvidence])).toEqual([["detector_missed", "identity_unresolved", false], ["out_of_frame", "no_candidate_pose", false]]);
  });
});
