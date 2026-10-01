import { useEffect, useRef, useState } from "react";

import { parseMotionTrackReviewManifest } from "../state/motion-track-review";
import { useWorkbenchStore } from "../state/workbench-store";
import type { MotionTrackReviewStatus } from "../types";

const STATUS_LABELS: Record<MotionTrackReviewStatus, string> = { tracked: "自动通过", manual_recovered: "人工恢复", detector_missed: "漏检", real_occlusion: "真实遮挡", out_of_frame: "出画", pending: "待审核" };
const STATUS_COLORS: Record<MotionTrackReviewStatus, string> = { tracked: "#34d399", manual_recovered: "#60a5fa", detector_missed: "#fb923c", real_occlusion: "#f87171", out_of_frame: "#94a3b8", pending: "#facc15" };

export function MotionTrackReviewPanel() {
  const source = useWorkbenchStore((state) => state.motionTrackImport.manifest);
  const review = useWorkbenchStore((state) => state.motionTrackReview);
  const load = useWorkbenchStore((state) => state.loadMotionTrackReviewManifest);
  const select = useWorkbenchStore((state) => state.selectMotionTrackReviewFrame);
  const setPlayhead = useWorkbenchStore((state) => state.setPlayheadFrame);
  const setStatus = useWorkbenchStore((state) => state.setMotionTrackReviewStatus);
  const setCandidate = useWorkbenchStore((state) => state.setMotionTrackReviewCandidate);
  const setNote = useWorkbenchStore((state) => state.setMotionTrackReviewerNote);
  const undo = useWorkbenchStore((state) => state.undoMotionTrackReview);
  const approve = useWorkbenchStore((state) => state.approveMotionTrackReview);
  const compile = useWorkbenchStore((state) => state.compileReviewedMotionTrack);
  const inputRef = useRef<HTMLInputElement>(null); const [error, setError] = useState<string | null>(null);
  const current = review.selectedFrame === null ? null : review.manifest?.frames.find((frame) => frame.frame === review.selectedFrame) ?? review.editedFrames[review.selectedFrame] ?? null;
  useEffect(() => { if (review.selectedFrame !== null) setPlayhead(review.selectedFrame); }, [review.selectedFrame, setPlayhead]);
  const loadFile = async (file: File | undefined) => { if (!file) return; try { const parsed = parseMotionTrackReviewManifest(JSON.parse(await file.text())); if (!parsed.ok || !parsed.manifest) throw new Error(parsed.errors.join("；")); load(parsed.manifest); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "review manifest 读取失败。"); } };
  const choose = (frame: number) => { select(frame); setPlayhead(frame); };
  return <section className="frame-reference-importer" aria-label="motion-track 人工审核"><div className="frame-reference-heading"><div><p className="kicker">Annotation review</p><strong>动作轨迹人工审核</strong><small>原始 motion-track 只读；人工修正保存在 overlay。</small></div><button type="button" onClick={() => inputRef.current?.click()}>导入 review JSON</button></div><input ref={inputRef} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => { void loadFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />{error && <p className="frame-reference-note">{error}</p>}{!source && <p className="frame-reference-note">请先导入原始 motion-track.v1。</p>}{source && review.manifest && <><div className="motion-review-markers" aria-label="问题帧 markers">{review.manifest.frames.map((frame) => { const item = review.editedFrames[frame.frame] ?? frame; return <button key={frame.frame} type="button" title={`${frame.frame}f · ${STATUS_LABELS[item.status]}`} style={{ borderColor: STATUS_COLORS[item.status], color: STATUS_COLORS[item.status] }} className={review.selectedFrame === frame.frame ? "active" : ""} onClick={() => choose(frame.frame)}>{frame.frame}</button>; })}</div><div className="frame-reference-summary"><strong>{review.manifest.reviewRequiredFrames} 个问题帧</strong><span>当前 {review.selectedFrame ?? "—"}f · {review.status}</span></div>{current && <div className="motion-review-form"><label><span>状态</span><select value={current.status} onChange={(event) => setStatus(current.frame, event.target.value as MotionTrackReviewStatus)}>{Object.keys(STATUS_LABELS).map((status) => <option key={status} value={status}>{STATUS_LABELS[status as MotionTrackReviewStatus]}</option>)}</select></label><label><span>候选人物</span><select value={current.selectedPoseIndex ?? ""} onChange={(event) => setCandidate(current.frame, event.target.value === "" ? null : Number(event.target.value))}><option value="">无目标</option>{current.candidates.map((candidate) => <option key={candidate.poseIndex} value={candidate.poseIndex}>pose {candidate.poseIndex}</option>)}</select></label><label><span>备注</span><textarea value={current.reviewerNote} onChange={(event) => setNote(current.frame, event.target.value)} rows={3} /></label><div className="frame-reference-actions"><button type="button" onClick={() => undo()}>撤销本次标注</button>{current.status === "pending" && <small>待审核帧不能进入 reviewed motion-track。</small>}</div></div>}<div className="frame-reference-actions"><button type="button" onClick={approve} disabled={review.status === "approved"}>标记审核完成</button><button type="button" onClick={() => { try { compile(); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "无法编译 reviewed motion-track。"); } }} disabled={review.status !== "approved"}>编译 reviewed motion-track</button></div></>}</section>;
}
