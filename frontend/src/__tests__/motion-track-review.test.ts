import { describe, expect, it } from "vitest";

import { compileReviewedMotionTrack, parseMotionTrackReviewManifest } from "../components/director3d/state/motion-track-review";
import type { MotionTrackImportState, MotionTrackReviewState } from "../components/director3d/types";

const source: MotionTrackImportState["manifest"] = { schema: "motion-track.v1", trackId: "t", sourceRevision: "sha-1", coordinateSystem: { image_x: "blender_x", image_y: "blender_z", depth_z: "blender_y" }, frames: [{ frame: 1, sourceFrame: 1, sourceTimestampSeconds: 0, selectionStatus: "occluded", rootPosition: null, semanticJoints: { left_ankle: [0, 0, 0] }, jointConfidence: {}, footTargets: { left: { ankle: null, heel: null, toe: null }, right: { ankle: null, heel: null, toe: null } }, footContactCandidates: { left: { candidate: false, confidence: 0 }, right: { candidate: false, confidence: 0 } } }] };

describe("motion track review", () => {
  it("compiles an approved review without mutating the raw source", () => {
    const parsed = parseMotionTrackReviewManifest({ schema: "motion-track-annotation-review.v1", source_track_revision: "sha-1", total_frames: 1, review_required_frames: 1, frames: [{ frame: 1, current_status: "occluded", suggested_status: "manual_review_required", candidates: [{ pose_index: 0, bbox: [0, 0, 1, 1], center: [0.5, 0.5], semantic_joints: { left_ankle: [1, 2, 3] } }], selected_pose_index: 0, status: "manual_recovered" }] });
    expect(parsed.ok).toBe(true);
    const review: MotionTrackReviewState = { status: "approved", manifest: parsed.manifest, selectedFrame: 1, editedFrames: {}, dirty: false, errors: [] };
    const result = compileReviewedMotionTrack(source, review);
    expect(result.manifest?.frames[0].selectionStatus).toBe("manual_recovered");
    expect(result.manifest?.frames[0].semanticJoints.left_ankle).toEqual([1, 2, 3]);
    expect(source.frames[0].selectionStatus).toBe("occluded");
  });
  it("rejects an unapproved or mismatched review", () => {
    const review: MotionTrackReviewState = { status: "ready", manifest: { schema: "motion-track-annotation-review.v1", sourceTrackRevision: "other", targetSubjectId: null, totalFrames: 1, reviewRequiredFrames: 1, frames: [] }, selectedFrame: null, editedFrames: {}, dirty: false, errors: [] };
    expect(() => compileReviewedMotionTrack(source, review)).toThrow("不匹配");
  });
});
