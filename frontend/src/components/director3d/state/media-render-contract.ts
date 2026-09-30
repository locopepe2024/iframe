import type { FullMotionBundle, MediaHostRenderRequest, MediaHostRenderResult } from "../types";

export function buildMediaHostRenderRequest(bundle: FullMotionBundle, requestId: string): MediaHostRenderRequest {
  const normalizedId = requestId.trim();
  if (!normalizedId || !/^[a-zA-Z0-9._:-]+$/.test(normalizedId)) throw new Error("requestId 格式无效。");
  if (bundle.review_status !== "ready_for_review" && bundle.review_status !== "needs_director_review") throw new Error("bundle review_status 无效。");
  return {
    schema: "director-media-render-request.v1",
    requestId: normalizedId,
    bundle: structuredClone(bundle),
    rigAsset: bundle.rig_asset,
    outputs: {
      whiteModelVideo: "white_model_video.mp4",
      whiteModelPreview: "white_model_preview.png",
      fullMotionBundle: "full_motion.bundle.json",
      retargetManifest: "retarget_manifest.json",
    },
    render: { width: 640, height: 360, fps: bundle.fps, engine: "blender", hostClass: "media" },
  };
}

export function validateMediaHostRenderResult(result: unknown, requestId: string): MediaHostRenderResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("media host result 必须是对象。");
  const value = result as Record<string, unknown>;
  if (value.schema !== "director-media-render-result.v1") throw new Error("media host result schema 不受支持。");
  if (value.requestId !== requestId) throw new Error("media host result requestId 不匹配。");
  if (!["queued", "running", "completed", "failed"].includes(String(value.status))) throw new Error("media host result status 无效。");
  if (!value.outputs || typeof value.outputs !== "object" || Array.isArray(value.outputs)) throw new Error("media host result outputs 无效。");
  return {
    schema: "director-media-render-result.v1",
    requestId,
    status: value.status as MediaHostRenderResult["status"],
    outputs: value.outputs as MediaHostRenderResult["outputs"],
    blenderVersion: typeof value.blenderVersion === "string" ? value.blenderVersion : null,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === "string") : [],
    error: typeof value.error === "string" ? value.error : null,
  };
}
