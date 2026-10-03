"use client";

import { useEffect, useMemo, useState } from "react";

type JointValue = [number, number, number?];
type AnnotationFrame = {
  frame: number;
  status?: string;
  joints?: Record<string, JointValue>;
  body?: Record<string, unknown>;
  reviewer_note?: string | null;
};

const JOINTS = ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel", "right_heel", "left_foot_index", "right_foot_index"];
const STATUS_OPTIONS = ["tracked", "manual_recovered", "detector_missed", "real_occlusion", "out_of_frame", "pending"];
const PHASE_OPTIONS = ["unknown", "neutral", "takeoff", "airborne", "landing", "turn", "contact"];
const ANNOTATION_DRAFT_KEY = "iframe.director3d.motion-annotation-review.v2";

function readJson(file: File): Promise<unknown> {
  return file.text().then((text) => JSON.parse(text) as unknown);
}

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function validPoint(value: unknown): value is JointValue {
  return Array.isArray(value) && (value.length === 2 || value.length === 3) && value.every((item) => typeof item === "number") && value[0] >= 0 && value[0] <= 1 && value[1] >= 0 && value[1] <= 1;
}

export function MotionAnnotationReviewPanel() {
  const [track, setTrack] = useState<Record<string, unknown> | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [sourceRevision, setSourceRevision] = useState("");
  const [frames, setFrames] = useState<AnnotationFrame[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [reviewer, setReviewer] = useState("director");
  const [error, setError] = useState<string | null>(null);

  const current = frames.find((item) => item.frame === selectedFrame) ?? null;
  const trackFrames = useMemo(() => Array.isArray(track?.frames) ? track.frames as Array<Record<string, unknown>> : [], [track]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ANNOTATION_DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { sourceRevision?: string; frames?: AnnotationFrame[]; reviewer?: string };
      if (saved.sourceRevision && saved.frames) { setSourceRevision(saved.sourceRevision); setFrames(saved.frames); }
      if (saved.reviewer) setReviewer(saved.reviewer);
    } catch { /* local draft is optional */ }
  }, []);

  useEffect(() => {
    if (!sourceRevision) return;
    try { window.localStorage.setItem(ANNOTATION_DRAFT_KEY, JSON.stringify({ schema: "motion-track-annotation-review.v2", sourceRevision, frames, reviewer })); } catch { /* storage may be unavailable */ }
  }, [frames, reviewer, sourceRevision]);

  const loadTrack = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await readJson(file) as Record<string, unknown>;
      if (parsed.schema !== "motion-track.v1") throw new Error("请选择 motion-track.v1 JSON。");
      const revision = typeof parsed.source_revision === "string" ? parsed.source_revision : "";
      if (!revision) throw new Error("源轨迹缺少 source_revision。");
      setTrack(parsed); setSourceName(file.name); setFrames((previous) => previous.length && sourceRevision === revision ? previous : []); setSourceRevision(revision); setError(null);
      const available = Array.isArray(parsed.frames) ? parsed.frames as Array<Record<string, unknown>> : [];
      setSelectedFrame(typeof available[0]?.frame === "number" ? available[0].frame as number : null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "源轨迹读取失败。"); }
  };

  const loadAnnotations = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await readJson(file) as Record<string, unknown>;
      if (parsed.schema !== "motion-track-annotation-review.v2") throw new Error("请选择 motion-track-annotation-review.v2 JSON。");
      if (parsed.source_revision !== sourceRevision) throw new Error("标注的 source_revision 与源轨迹不一致。");
      const incoming = Array.isArray(parsed.frames) ? parsed.frames as AnnotationFrame[] : [];
      setFrames(incoming); setSelectedFrame(incoming[0]?.frame ?? selectedFrame); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "标注读取失败。"); }
  };

  const updateCurrent = (update: (value: AnnotationFrame) => AnnotationFrame) => {
    if (selectedFrame === null) return;
    setFrames((items) => {
      const existing = items.find((item) => item.frame === selectedFrame) ?? { frame: selectedFrame, status: "manual_recovered", joints: {}, body: {}, reviewer_note: null };
      const next = update(existing);
      return items.some((item) => item.frame === selectedFrame) ? items.map((item) => item.frame === selectedFrame ? next : item) : [...items, next].sort((a, b) => a.frame - b.frame);
    });
  };

  const setJoint = (joint: string, axis: 0 | 1, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    updateCurrent((item) => {
      const joints = { ...(item.joints ?? {}) };
      const previous = joints[joint] ?? [0.5, 0.5, 0];
      const next: JointValue = [previous[0] ?? 0.5, previous[1] ?? 0.5, previous[2] ?? 0];
      next[axis] = value; joints[joint] = next;
      return { ...item, status: item.status ?? "manual_recovered", joints };
    });
  };

  const buildReviewed = () => {
    if (!track) return null;
    const reviewed = JSON.parse(JSON.stringify(track)) as Record<string, unknown>;
    reviewed.schema = "motion-track-reviewed.v1"; reviewed.source_schema = "motion-track.v1"; reviewed.source_track_revision = sourceRevision;
    reviewed.annotation_schema = "motion-track-annotation-review.v2"; reviewed.reviewer = reviewer; reviewed.review_status = "draft";
    reviewed.reviewed_frames = frames.map((item) => item.frame).sort((a, b) => a - b);
    const byFrame = new Map(frames.map((item) => [item.frame, item]));
    const sourceFrames = Array.isArray(reviewed.frames) ? reviewed.frames as Array<Record<string, unknown>> : [];
    for (const source of sourceFrames) {
      const edit = byFrame.get(Number(source.frame)); if (!edit) continue;
      const joints = { ...((source.semantic_joints as Record<string, JointValue> | undefined) ?? {}) };
      for (const [name, value] of Object.entries(edit.joints ?? {})) if (validPoint(value)) joints[name] = [value[0], value[1], value[2] ?? Number((joints[name] as JointValue | undefined)?.[2] ?? 0)];
      if (joints.left_hip && joints.right_hip) joints.hip_center = [(joints.left_hip[0] + joints.right_hip[0]) / 2, (joints.left_hip[1] + joints.right_hip[1]) / 2, ((joints.left_hip[2] ?? 0) + (joints.right_hip[2] ?? 0)) / 2];
      if (joints.left_shoulder && joints.right_shoulder) joints.shoulder_center = [(joints.left_shoulder[0] + joints.right_shoulder[0]) / 2, (joints.left_shoulder[1] + joints.right_shoulder[1]) / 2, ((joints.left_shoulder[2] ?? 0) + (joints.right_shoulder[2] ?? 0)) / 2];
      source.semantic_joints = joints; if (edit.status) source.selection_status = edit.status;
      source.review = { source: "manual", reviewer, body: edit.body ?? {}, note: edit.reviewer_note ?? null, corrected_joints: Object.keys(edit.joints ?? {}).sort() };
    }
    return reviewed;
  };

  return <section className="motion-annotation-review panel-section" aria-label="动作关键帧标注">
    <div className="section-heading"><div><p className="kicker">Motion review</p><h3>人工动作标注</h3></div><span className="count-badge">{frames.length} 帧</span></div>
    <p className="inspector-help">只修改 reviewed 副本，原始 motion-track.v1 保持不变。坐标为 0–1 归一化图像坐标。</p>
    <div className="motion-annotation-file-row"><label>源轨迹<input type="file" accept=".json,application/json" onChange={(event) => { void loadTrack(event.target.files?.[0]); event.currentTarget.value = ""; }}/></label><label>人工标注<input type="file" accept=".json,application/json" disabled={!track} onChange={(event) => { void loadAnnotations(event.target.files?.[0]); event.currentTarget.value = ""; }}/></label></div>
    {sourceName && <small className="motion-annotation-meta">{sourceName} · revision {sourceRevision.slice(0, 12)}… · {trackFrames.length} 帧</small>}
    {error && <p className="motion-annotation-error" role="alert">{error}</p>}
    {track && <div className="motion-annotation-editor">
      <label>关键帧<select value={selectedFrame ?? ""} onChange={(event) => setSelectedFrame(Number(event.target.value))}>{trackFrames.map((item) => <option key={String(item.frame)} value={String(item.frame)}>{String(item.frame)}f{frames.some((edited) => edited.frame === Number(item.frame)) ? " · 已标注" : ""}</option>)}</select></label>
      {selectedFrame !== null && !current && <button type="button" onClick={() => updateCurrent((item) => ({ ...item, status: "manual_recovered", joints: {} }))}>标记当前帧并开始编辑</button>}
      {current && <>
        <label>状态<select value={current.status ?? "manual_recovered"} onChange={(event) => updateCurrent((item) => ({ ...item, status: event.target.value }))}>{STATUS_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
        <div className="motion-annotation-grid">{JOINTS.map((joint) => <div className="motion-annotation-joint" key={joint}><strong>{joint}</strong><label>x<input type="number" min="0" max="1" step="0.001" value={current.joints?.[joint]?.[0] ?? ""} onChange={(event) => setJoint(joint, 0, event.target.value)}/></label><label>y<input type="number" min="0" max="1" step="0.001" value={current.joints?.[joint]?.[1] ?? ""} onChange={(event) => setJoint(joint, 1, event.target.value)}/></label></div>)}</div>
        <div className="motion-annotation-body"><label>动作阶段<select value={String(current.body?.phase ?? "unknown")} onChange={(event) => updateCurrent((item) => ({ ...item, body: { ...(item.body ?? {}), phase: event.target.value } }))}>{PHASE_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label><label>Root yaw<input type="number" step="1" value={Number(current.body?.root_yaw_degrees ?? 0)} onChange={(event) => updateCurrent((item) => ({ ...item, body: { ...(item.body ?? {}), root_yaw_degrees: Number(event.target.value) } }))}/></label><label><input type="checkbox" checked={Boolean(current.body?.left_foot_contact)} onChange={(event) => updateCurrent((item) => ({ ...item, body: { ...(item.body ?? {}), left_foot_contact: event.target.checked } }))}/> 左脚接触</label><label><input type="checkbox" checked={Boolean(current.body?.right_foot_contact)} onChange={(event) => updateCurrent((item) => ({ ...item, body: { ...(item.body ?? {}), right_foot_contact: event.target.checked } }))}/> 右脚接触</label></div>
        <label>备注<textarea value={current.reviewer_note ?? ""} onChange={(event) => updateCurrent((item) => ({ ...item, reviewer_note: event.target.value }))}/></label>
      </>}
      <div className="motion-annotation-actions"><label>审核人<input value={reviewer} onChange={(event) => setReviewer(event.target.value)}/></label><button type="button" className="primary" onClick={() => { const output = buildReviewed(); if (output) downloadJson("motion-track-reviewed.v1.json", output); }} disabled={frames.length === 0}>导出 reviewed JSON</button></div>
    </div>}
  </section>;
}
