import { useEffect, useState } from "react";
import type { MotionTrackVector3 } from "../types";

export interface PoseProjectionEvidence {
  schema: "motion-frame-projection.v1";
  source_revision: string;
  source_frame: number;
  coordinate_system: "normalized_image_top_left";
  alignment: "camera" | "similarity_fit";
  image_width: number;
  image_height: number;
  joints: Record<string, [number, number]>;
}
export function parsePoseProjectionEvidence(raw: unknown, revision: string | null, frame: number): PoseProjectionEvidence {
  const item = raw as PoseProjectionEvidence | null;
  if (!item || item.schema !== "motion-frame-projection.v1" || !revision || item.source_revision !== revision || item.source_frame !== frame) throw new Error("投影证据的源版本或源帧不匹配。");
  if (item.coordinate_system !== "normalized_image_top_left" || !["camera", "similarity_fit"].includes(item.alignment)) throw new Error("投影坐标必须声明图像左上原点及对齐方式。");
  if (![item.image_width, item.image_height].every((v) => Number.isInteger(v) && v > 0 && v <= 32768)) throw new Error("投影证据缺少有效图像尺寸。");
  if (!item.joints || typeof item.joints !== "object" || Array.isArray(item.joints) || !Object.keys(item.joints).length || Object.values(item.joints).some((p) => !Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === "number" && Number.isFinite(v)))) throw new Error("投影关节点必须为有限的二维坐标。");
  return item;
}
const SEGMENTS = [
  ["left_shoulder", "right_shoulder"], ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"], ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"], ["left_hip", "right_hip"], ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"], ["right_hip", "right_knee"], ["right_knee", "right_ankle"],
  ["left_ankle", "left_heel"], ["left_heel", "left_foot_index"], ["right_ankle", "right_heel"], ["right_heel", "right_foot_index"],
];
export function MotionFrameEvidence({ revision, frame, original, corrected }: { revision: string | null; frame: number; original: Record<string, MotionTrackVector3>; corrected: Record<string, MotionTrackVector3> }) {
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [projection, setProjection] = useState<PoseProjectionEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  const width = image?.width ?? projection?.image_width ?? 640;
  const height = image?.height ?? projection?.image_height ?? 360;
  const projected = projection?.joints ?? {};
  const points = Object.entries(corrected).filter(([name]) => projected[name]);
  const rmse = points.length ? Math.sqrt(points.reduce((sum, [name, p]) => sum + ((p[0] - projected[name][0]) * width) ** 2 + ((p[1] - projected[name][1]) * height) ** 2, 0) / points.length) : null;
  const skeleton = (joints: Record<string, number[]>, color: string, labels: boolean) => <g stroke={color} fill={color} strokeWidth="2">
    {SEGMENTS.map(([a, b]) => joints[a] && joints[b] ? <line key={`${a}-${b}`} x1={joints[a][0] * width} y1={joints[a][1] * height} x2={joints[b][0] * width} y2={joints[b][1] * height} /> : null)}
    {Object.entries(joints).map(([name, p]) => <g key={name}><circle cx={p[0] * width} cy={p[1] * height} r="3" />{labels && <text x={p[0] * width + 5} y={p[1] * height - 5} stroke="none" fontSize="12">{name}</text>}</g>)}
  </g>;
  return <fieldset className="motion-joint-review"><legend>源帧与骨架对照 · {frame}f</legend>
    <p>请选择该源帧图片。青色为自动检测，绿色为当前审核骨架，紫色为导入的 Blender 投影；虚线显示残差。</p>
    <label>源帧图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file) return;
      const url = URL.createObjectURL(file); const probe = new Image();
      probe.onload = () => { if (projection && (probe.naturalWidth !== projection.image_width || probe.naturalHeight !== projection.image_height)) { URL.revokeObjectURL(url); setError("源图尺寸与投影证据不一致。"); return; } setImage({ url, width: probe.naturalWidth, height: probe.naturalHeight }); setError(null); };
      probe.onerror = () => { URL.revokeObjectURL(url); setError("无法读取源帧图片。"); }; probe.src = url;
    }} /></label>
    <label>Blender 投影 JSON<input type="file" accept=".json,application/json" onChange={async (event) => {
      const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file) return;
      try { const next = parsePoseProjectionEvidence(JSON.parse(await file.text()), revision, frame); if (image && (image.width !== next.image_width || image.height !== next.image_height)) throw new Error("投影图像尺寸与源图不一致。"); setProjection(next); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "无法读取投影。"); }
    }} /></label>
    <svg className="motion-frame-evidence" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`第 ${frame} 帧骨架对照`}>
      {image && <image href={image.url} width={width} height={height} />}
      {skeleton(original, "#22d3ee", false)}{skeleton(corrected, "#34d399", true)}{skeleton(projected, "#c084fc", false)}
      <g stroke="#f8fafc" strokeDasharray="4 3">{points.map(([name, p]) => <line key={name} x1={p[0] * width} y1={p[1] * height} x2={projected[name][0] * width} y2={projected[name][1] * height} />)}</g>
    </svg>
    {!image && <small>尚未选择源帧图片，当前仅显示骨架示意；图片帧号须由审核人确认。</small>}
    {projection && <small>{projection.alignment === "similarity_fit" ? "相似变换拟合后投影，不能验证整体朝向" : "相机直接投影"} · {points.length} 个共有关节 · 像素 RMSE {rmse?.toFixed(2) ?? "无共有关节"}</small>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
