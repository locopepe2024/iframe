export type PanoramaSceneReviewStatus = "candidate" | "panorama_verified" | "depth_draft" | "needs_director_review" | "production_ready";

export interface PanoramaScenePackage {
  schema: "director-panorama-scene-package.v1";
  panoramaInputId: string;
  panoramaChecksum: string;
  coordinateSystem: "blender_x_right_y_depth_z_up";
  horizonYNormalized: number;
  depth: { inputId: string; checksum?: string; nearM: number; farM: number; quality: "draft" | "reviewed" | "verified" };
  semanticAnchors: Array<{ anchorId: string; kind: string; positionM: [number, number, number]; confidence: number }>;
  ground: { heightM: number; quality: "draft" | "reviewed" | "verified" };
  blockingCodes: string[];
  reviewStatus: PanoramaSceneReviewStatus;
  estimatorVersion: string;
}

type RecordValue = Record<string, unknown>;
const SHA256 = /^[a-f0-9]{64}$/;
const PANORAMA_PATH = /^\/playground\/input-media\/[^/]+$/;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function tuple3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === "number" && Number.isFinite(item));
}

function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function parsePanoramaScenePackage(input: unknown): { ok: true; package: PanoramaScenePackage } | { ok: false; errors: string[] } {
  const value = record(input);
  const errors: string[] = [];
  if (!value || value.schema !== "director-panorama-scene-package.v1") errors.push("schema 必须为 director-panorama-scene-package.v1。");
  if (!value || typeof value.panoramaInputId !== "string" || !PANORAMA_PATH.test(value.panoramaInputId)) errors.push("panoramaInputId 必须是 owner-scoped Playground 图片路径。");
  if (!value || typeof value.panoramaChecksum !== "string" || !SHA256.test(value.panoramaChecksum)) errors.push("panoramaChecksum 必须是 sha256。");
  if (!value || value.coordinateSystem !== "blender_x_right_y_depth_z_up") errors.push("coordinateSystem 不受支持。");
  if (!value || !bounded(value.horizonYNormalized, 0, 1)) errors.push("horizonYNormalized 必须在 0 到 1 之间。");
  const depth = record(value?.depth);
  if (!depth || typeof depth.inputId !== "string" || !depth.inputId || (depth.checksum !== undefined && (typeof depth.checksum !== "string" || !SHA256.test(depth.checksum))) || !bounded(depth.nearM, 0.001, 9999) || !bounded(depth.farM, 0.002, 10000) || Number(depth.farM) <= Number(depth.nearM) || !["draft", "reviewed", "verified"].includes(String(depth.quality))) errors.push("depth 契约无效，必须声明输入、范围和质量状态。");
  const ground = record(value?.ground);
  if (!ground || !bounded(ground.heightM, -10000, 10000) || !["draft", "reviewed", "verified"].includes(String(ground.quality))) errors.push("ground 契约无效。");
  if (!Array.isArray(value?.blockingCodes) || !value.blockingCodes.every(item => typeof item === "string" && item.length > 0)) errors.push("blockingCodes 必须是字符串数组。");
  if (!Array.isArray(value?.semanticAnchors)) errors.push("semanticAnchors 必须是数组。");
  const anchors = Array.isArray(value?.semanticAnchors) ? value.semanticAnchors : [];
  anchors.forEach((item, index) => {
    const anchor = record(item);
    if (!anchor || typeof anchor.anchorId !== "string" || typeof anchor.kind !== "string" || !tuple3(anchor.positionM) || !bounded(anchor.confidence, 0, 1)) errors.push(`semanticAnchors[${index}] 无效。`);
  });
  const statuses: PanoramaSceneReviewStatus[] = ["candidate", "panorama_verified", "depth_draft", "needs_director_review", "production_ready"];
  if (!value || !statuses.includes(value.reviewStatus as PanoramaSceneReviewStatus)) errors.push("reviewStatus 无效。");
  if (!value || typeof value.estimatorVersion !== "string" || !value.estimatorVersion.trim()) errors.push("estimatorVersion 必须存在。");
  if (errors.length) return { ok: false, errors };
  return { ok: true, package: value as unknown as PanoramaScenePackage };
}

export function assertPanoramaScenePackage(input: unknown): PanoramaScenePackage {
  const result = parsePanoramaScenePackage(input);
  if (!result.ok) throw new Error(result.errors.join(" "));
  return result.package;
}
