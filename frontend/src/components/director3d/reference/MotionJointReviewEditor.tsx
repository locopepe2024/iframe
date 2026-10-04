import { useState } from "react";
import type { MotionTrackVector3 } from "../types";

const JOINTS = ["nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel", "right_heel", "left_foot_index", "right_foot_index"];

export function MotionJointReviewEditor({ joints, onApply }: { joints: Record<string, MotionTrackVector3>; onApply: (joint: string, value: MotionTrackVector3) => void }) {
  const [joint, setJoint] = useState("left_shoulder");
  const [draft, setDraft] = useState<[string, string] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const point = joints[joint];
  const coordinates: [string, string] = draft ?? [point ? String(point[0]) : "", point ? String(point[1]) : ""];
  const apply = () => {
    if (!point || !Number.isFinite(point[2])) { setError("该关节没有深度证据；请先选择包含该关节的候选人物。"); return; }
    const xy = coordinates.map((value) => value.trim() === "" ? NaN : Number(value));
    if (xy.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) { setError("X、Y 必须为 0–1 的归一化图像坐标。"); return; }
    onApply(joint, [xy[0], xy[1], point[2]]); setDraft(null); setError(null);
  };
  return <fieldset className="motion-joint-review">
    <legend>关节二维修正</legend>
    <p>修改图像位置，保留源轨迹的深度估计；不代表真实三维测量。</p>
    <label>关节<select value={joint} onChange={(event) => { setJoint(event.target.value); setDraft(null); setError(null); }}>{JOINTS.map((name) => <option key={name}>{name}</option>)}</select></label>
    <div className="motion-joint-coordinates">{([0, 1] as const).map((axis) => <label key={axis}>{axis === 0 ? "图像 X" : "图像 Y"}<input type="number" step="0.001" min="0" max="1" value={coordinates[axis]} onChange={(event) => { const next: [string, string] = [...coordinates]; next[axis] = event.target.value; setDraft(next); }} /></label>)}</div>
    <small>保留 Z：{point ? String(point[2]) : "缺失"}</small>
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={apply}>应用关节修正</button>
  </fieldset>;
}
