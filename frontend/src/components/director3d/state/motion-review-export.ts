import type { MotionTrackManifest, MotionTrackReviewState } from "../types";

export function exportMotionReviewOverlay(review: MotionTrackReviewState) {
  if (!review.manifest) throw new Error("尚未导入审核记录。");
  return {
    schema: review.manifest.schema,
    source_track_revision: review.manifest.sourceTrackRevision,
    target_subject_id: review.manifest.targetSubjectId,
    total_frames: review.manifest.totalFrames,
    review_required_frames: review.manifest.reviewRequiredFrames,
    frames: review.manifest.frames.map((raw) => {
      const frame = review.editedFrames[raw.frame] ?? raw;
      return { frame: frame.frame, timestamp_seconds: frame.timestampSeconds, current_status: frame.currentStatus,
        selection_reason: frame.selectionReason, occlusion_evidence: frame.occlusionEvidence,
        suggested_status: frame.suggestedStatus, target_track_id: frame.targetTrackId,
        selected_pose_index: frame.selectedPoseIndex, status: frame.status, joint_overrides: frame.jointOverrides, reviewer_note: frame.reviewerNote,
        candidates: frame.candidates.map((c) => ({ pose_index: c.poseIndex, bbox: c.bbox, center: c.center, distance_to_previous_center: c.distanceToPreviousCenter, semantic_joints: c.semanticJoints ?? {} })) };
    }),
  };
}

export function exportReviewedMotionTrack(manifest: MotionTrackManifest) {
  return { schema: manifest.schema, track_id: manifest.trackId, source_revision: manifest.sourceRevision,
    coordinate_system: manifest.coordinateSystem,
    frames: manifest.frames.map((frame) => ({ frame: frame.frame, source_frame: frame.sourceFrame ?? frame.frame,
      source_timestamp_seconds: frame.sourceTimestampSeconds, selection_status: frame.selectionStatus,
      selection_reason: frame.selectionReason, occlusion_evidence: frame.occlusionEvidence,
      root_position: frame.rootPosition, semantic_joints: frame.semanticJoints, joint_confidence: frame.jointConfidence,
      foot_targets: frame.footTargets, foot_contact_candidates: frame.footContactCandidates, body_centers: frame.bodyCenters })) };
}

export function downloadMotionJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
