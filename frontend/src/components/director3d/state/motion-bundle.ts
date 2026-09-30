import type { FullMotionBundle, MotionBundleBuildInput } from "../types";

function finiteInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} 必须是正整数。`);
  return value;
}

export function buildFullMotionBundle(input: MotionBundleBuildInput): FullMotionBundle {
  const start = finiteInteger(input.frameRange[0], "frameRange[0]");
  const end = finiteInteger(input.frameRange[1], "frameRange[1]");
  if (end < start) throw new Error("frameRange 必须按递增顺序声明。");
  if (!Number.isFinite(input.fps) || input.fps <= 0 || input.fps > 240) throw new Error("fps 必须是 0–240 的有限数字。");
  if (input.retarget.mode !== "local_quaternion_v1") throw new Error("不支持的 retarget mode。");
  const warnings = [...input.retarget.warnings, ...(input.warnings ?? [])];
  if (!input.ikEnabled) warnings.push("IK 未启用；foot contact candidates 仍需导演审核。");
  return {
    schema: "director-full-motion-bundle.v1",
    source_track_revision: input.sourceTrackRevision,
    rig_asset: input.rigAsset,
    rig_mapping_revision: input.rigMapping.revision,
    retarget_mode: input.retarget.mode,
    ik_enabled: input.ikEnabled,
    cleanup_processors: structuredClone(input.retarget.cleanupProcessors ?? []),
    frame_range: [start, end],
    fps: input.fps,
    coordinate_system: structuredClone(input.coordinateSystem),
    warnings: Array.from(new Set(warnings)),
    review_status: input.reviewStatus ?? "needs_director_review",
    frames: structuredClone(input.retarget.frames),
    ik_statuses: structuredClone(input.ikStatuses ?? []),
  };
}

export function serializeFullMotionBundle(input: MotionBundleBuildInput): string {
  return JSON.stringify(buildFullMotionBundle(input), null, 2);
}
