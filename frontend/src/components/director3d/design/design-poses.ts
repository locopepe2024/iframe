import { posePresetById, type PosePresetId } from "../pose/pose-presets";
import type { CharacterAuthoringState } from "../state/workbench-store";

export const DESIGN_POSES = ["pose.neutral", "standing.relaxed", "standing.hands_on_hips", "gesture.wave", "gesture.arms_crossed", "gesture.thinking", "kneeling.single_knee"] as const satisfies readonly PosePresetId[];
export type DesignPoseId = typeof DESIGN_POSES[number];

// Calibrated from the shipped GLB's evaluated seated skin. See geometry test.
export const SEATED_FIT = {
  groundLiftM: 0.06040600345531344,
  supportHeightM: 0.43773599708598837,
  sourceSha256: "d31319921ff0cc8600ccc2aa822a17503483f192a32dda2fc2a5f5ce61f111cf",
};

export function applyDesignPose(actor: CharacterAuthoringState, presetId: PosePresetId) {
  const preset = posePresetById.get(presetId);
  if (!preset) throw new Error("姿态预设不可用。");
  actor.jointRotations = structuredClone(preset.rotations);
  actor.poseRootOffsetM = [...(preset.rootOffsetM ?? [0, 0, 0])];
  actor.activePresetId = presetId;
  actor.adjustedJointIds = [];
  actor.poseRevision += 1;
}
