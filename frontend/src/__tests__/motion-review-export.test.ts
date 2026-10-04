import { expect, it } from "vitest";
import { compileReviewedMotionTrack, parseMotionTrackReviewManifest } from "../components/director3d/state/motion-track-review";
import { exportMotionReviewOverlay, exportReviewedMotionTrack } from "../components/director3d/state/motion-review-export";
import { parseMotionTrackManifest } from "../components/director3d/state/motion-track-import";
import type { MotionTrackManifest, MotionTrackReviewState } from "../components/director3d/types";
it("round-trips reviewed evidence and invalidates stale foot contacts without mutating source", () => {
 const source: MotionTrackManifest = { schema: "motion-track.v1", trackId: "t", sourceRevision: "sha", coordinateSystem: { image_x: "blender_x", image_y: "blender_z", depth_z: "blender_y" }, frames: [{ frame: 1, sourceFrame: 12, sourceTimestampSeconds: 0.4, selectionStatus: "tracked", rootPosition: null, semanticJoints: { left_ankle: [0.4, 0.9, -0.1] }, jointConfidence: {}, footTargets: { left: { ankle: [0.4, 0.9, -0.1], heel: null, toe: null }, right: { ankle: null, heel: null, toe: null } }, footContactCandidates: { left: { candidate: true, confidence: 1 }, right: { candidate: false, confidence: 0 } } }] };
 const parsed = parseMotionTrackReviewManifest({ schema: "motion-track-annotation-review.v1", source_track_revision: "sha", frames: [{ frame: 1, status: "manual_recovered", joint_overrides: { left_ankle: [0.5, 0.8, -0.1] } }] });
 const review: MotionTrackReviewState = { status: "approved", manifest: parsed.manifest, selectedFrame: 1, editedFrames: {}, dirty: true, errors: [] };
 const compiled = compileReviewedMotionTrack(source, review);
 const reloaded = parseMotionTrackManifest(exportReviewedMotionTrack(compiled.manifest!));
 expect(reloaded.ok).toBe(true);
 expect(reloaded.state.manifest?.sourceRevision).toBe(compiled.report.outputRevision);
 expect(reloaded.state.manifest?.frames[0].footTargets.left.ankle).toEqual([0.5, 0.8, -0.1]);
 expect(reloaded.state.manifest?.frames[0].footContactCandidates.left.candidate).toBe(false);
 expect(source.frames[0].footTargets.left.ankle).toEqual([0.4, 0.9, -0.1]);
 expect(parseMotionTrackReviewManifest(exportMotionReviewOverlay(review)).manifest?.frames[0].jointOverrides.left_ankle).toEqual([0.5, 0.8, -0.1]);
});
