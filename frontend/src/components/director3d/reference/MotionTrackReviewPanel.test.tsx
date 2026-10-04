import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionTrackReviewPanel } from "./MotionTrackReviewPanel";
import { useWorkbenchStore } from "../state/workbench-store";
import { parseMotionTrackReviewManifest } from "../state/motion-track-review";
import type { MotionTrackImportState } from "../types";
const initial = useWorkbenchStore.getState();
afterEach(() => { cleanup(); useWorkbenchStore.setState(initial, true); });
function prepare() {
  const parsed = parseMotionTrackReviewManifest({ schema: "motion-track-annotation-review.v1", source_track_revision: "sha", frames: [{ frame: 1, status: "tracked", reviewer_note: "original", candidates: [{ pose_index: 0, semantic_joints: {} }], selected_pose_index: null }] });
  const source: NonNullable<MotionTrackImportState["manifest"]> = { schema: "motion-track.v1", trackId: "t", sourceRevision: "sha", coordinateSystem: { image_x: "blender_x", image_y: "blender_z", depth_z: "blender_y" }, frames: [] };
  useWorkbenchStore.setState({ motionTrackImport: { ...initial.motionTrackImport, manifest: source } });
  useWorkbenchStore.getState().loadMotionTrackReviewManifest(parsed.manifest);
  render(<MotionTrackReviewPanel />);
  fireEvent.click(screen.getByRole("button", { name: "1" }));
}
it("shows cumulative review edits and restores them on undo without changing evidence", () => {
  prepare();
  fireEvent.change(screen.getByLabelText("备注"), { target: { value: "corrected" } });
  expect(screen.getByLabelText("备注")).toHaveValue("corrected");
  fireEvent.change(screen.getByLabelText("候选人物"), { target: { value: "0" } });
  expect(screen.getByLabelText("候选人物")).toHaveValue("0");
  expect(screen.getByLabelText("状态")).toHaveValue("manual_recovered");
  expect(screen.getByLabelText("备注")).toHaveValue("corrected");
  fireEvent.change(screen.getByLabelText("状态"), { target: { value: "detector_missed" } });
  expect(screen.getByLabelText("状态")).toHaveValue("detector_missed");
  fireEvent.click(screen.getByRole("button", { name: "撤销本次标注" }));
  expect(screen.getByLabelText("状态")).toHaveValue("manual_recovered");
  expect(screen.getByLabelText("备注")).toHaveValue("corrected");
  expect(useWorkbenchStore.getState().motionTrackReview.manifest?.frames[0].reviewerNote).toBe("original");
});
