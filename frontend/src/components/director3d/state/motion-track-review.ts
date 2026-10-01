import type { MotionTrackAnnotationReview, MotionTrackFrame, MotionTrackFrameReview, MotionTrackImportState, MotionTrackReviewReport, MotionTrackReviewState, MotionTrackReviewStatus, MotionTrackVector3 } from "../types";

const STATUSES = new Set<MotionTrackReviewStatus>(["tracked", "manual_recovered", "detector_missed", "real_occlusion", "out_of_frame", "pending"]);
const JOINTS = ["left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel", "right_heel", "left_foot_index", "right_foot_index"];
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function vector(value: unknown): MotionTrackVector3 | null { return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item)) ? value as MotionTrackVector3 : null; }
function frameReview(raw: unknown, index: number): MotionTrackFrameReview {
  const value = record(raw); const frame = typeof value.frame === "number" ? Math.round(value.frame) : index + 1;
  const candidates = Array.isArray(value.candidates) ? value.candidates.map((candidate) => {
    const item = record(candidate); const bbox = Array.isArray(item.bbox) && item.bbox.length === 4 ? item.bbox.map(Number) as [number, number, number, number] : [0, 0, 0, 0];
    const center = Array.isArray(item.center) && item.center.length === 2 ? item.center.map(Number) as [number, number] : [0, 0];
    return { poseIndex: typeof item.pose_index === "number" ? Math.round(item.pose_index) : 0, bbox: bbox as [number, number, number, number], center: center as [number, number], distanceToPreviousCenter: typeof item.distance_to_previous_center === "number" ? item.distance_to_previous_center : null, semanticJoints: record(item.semantic_joints) as Record<string, MotionTrackVector3> };
  }) : [];
  const requestedStatus = value.status;
  return { frame, timestampSeconds: typeof value.timestamp_seconds === "number" ? value.timestamp_seconds : null, currentStatus: typeof value.current_status === "string" ? value.current_status as MotionTrackFrameReview["currentStatus"] : "unknown", selectionReason: typeof value.selection_reason === "string" ? value.selection_reason : null, occlusionEvidence: value.occlusion_evidence === true, suggestedStatus: value.suggested_status === "manual_review_required" ? "manual_review_required" : null, targetTrackId: typeof value.target_track_id === "string" ? value.target_track_id : null, candidates, selectedPoseIndex: typeof value.selected_pose_index === "number" ? Math.round(value.selected_pose_index) : null, status: typeof requestedStatus === "string" && STATUSES.has(requestedStatus as MotionTrackReviewStatus) ? requestedStatus as MotionTrackReviewStatus : "pending", jointOverrides: Object.fromEntries(Object.entries(record(value.joint_overrides)).flatMap(([joint, point]) => { const parsed = vector(point); return parsed ? [[joint, parsed]] : []; })), reviewerNote: typeof value.reviewer_note === "string" ? value.reviewer_note.slice(0, 1000) : "" };
}

export function parseMotionTrackReviewManifest(input: unknown): { ok: boolean; manifest: MotionTrackAnnotationReview | null; errors: string[] } {
  const value = record(input); if (value.schema !== "motion-track-annotation-review.v1") return { ok: false, manifest: null, errors: ["schema 必须为 motion-track-annotation-review.v1。"] };
  if (!Array.isArray(value.frames)) return { ok: false, manifest: null, errors: ["frames 必须是数组。"] };
  const frames = value.frames.map(frameReview);
  return { ok: true, manifest: { schema: "motion-track-annotation-review.v1", sourceTrackRevision: typeof value.source_track_revision === "string" ? value.source_track_revision : null, targetSubjectId: typeof value.target_subject_id === "string" ? value.target_subject_id : null, totalFrames: typeof value.total_frames === "number" ? value.total_frames : frames.length, reviewRequiredFrames: typeof value.review_required_frames === "number" ? value.review_required_frames : frames.filter((frame) => frame.status === "pending").length, frames } , errors: [] };
}

export function createIdleMotionTrackReviewState(): MotionTrackReviewState { return { status: "idle", manifest: null, selectedFrame: null, editedFrames: {}, dirty: false, errors: [] }; }

function mergedFrame(source: MotionTrackFrame, review: MotionTrackFrameReview | undefined): MotionTrackFrame {
  if (!review) return structuredClone(source);
  const selected = review.selectedPoseIndex === null ? null : review.candidates.find((candidate) => candidate.poseIndex === review.selectedPoseIndex);
  const semanticJoints = { ...source.semanticJoints, ...(selected?.semanticJoints ?? {}), ...review.jointOverrides };
  const safeStatus = review.status === "pending" ? source.selectionStatus : review.status;
  return { ...structuredClone(source), selectionStatus: safeStatus, selectionReason: `director_review:${review.status}`, occlusionEvidence: review.status === "real_occlusion", semanticJoints: review.status === "real_occlusion" || review.status === "out_of_frame" ? {} : semanticJoints };
}

export function compileReviewedMotionTrack(source: MotionTrackImportState["manifest"], review: MotionTrackReviewState): { manifest: MotionTrackImportState["manifest"]; report: MotionTrackReviewReport } {
  if (!source) throw new Error("尚未导入原始 motion-track。");
  if (!review.manifest) throw new Error("尚未导入 annotation review manifest。");
  if (review.manifest.sourceTrackRevision !== source.sourceRevision) throw new Error("review source revision 与原始 motion-track 不匹配。");
  if (review.status !== "approved") throw new Error("review 必须先 approved 才能编译。");
  const byFrame = new Map(review.manifest.frames.map((frame) => [frame.frame, review.editedFrames[frame.frame] ?? frame])); const frames = source.frames.map((frame) => mergedFrame(frame, byFrame.get(frame.frame)));
  const missingFrames = frames.flatMap((frame) => { const reviewFrame = byFrame.get(frame.frame); const missingJoints = JOINTS.filter((joint) => !frame.semanticJoints[joint]); return missingJoints.length && reviewFrame?.status !== "real_occlusion" && reviewFrame?.status !== "out_of_frame" ? [{ frame: frame.frame, missingJoints, status: reviewFrame?.status ?? "pending", reason: reviewFrame ? "missing semantic joints after review" : "frame not reviewed" }] : []; });
  const counts = Object.fromEntries(( ["tracked", "manual_recovered", "detector_missed", "real_occlusion", "out_of_frame", "pending"] as MotionTrackReviewStatus[]).map((status) => [status, review.manifest!.frames.filter((frame) => (review.editedFrames[frame.frame] ?? frame).status === status).length])) as Record<MotionTrackReviewStatus, number>;
  const outputRevision = `${source.sourceRevision ?? "unknown"}:review:${review.manifest.sourceTrackRevision ?? "unknown"}:${review.manifest.frames.length}`;
  return { manifest: { ...structuredClone(source), sourceRevision: outputRevision, frames }, report: { sourceRevision: source.sourceRevision, outputRevision, totalFrames: frames.length, counts, missingFrames, errors: [] } };
}
