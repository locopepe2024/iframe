"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { API_URL } from "@/lib/api";
import { poseJoints, poseReviewApi, PoseJointName, PoseReviewFrame, PoseVisibility, RecreationProject, seconds } from "@/lib/recreation";

export default function PoseReview({ project }: { project: RecreationProject }) {
  const t = useTranslations("recreation.poseReview");
  const [opened, setOpened] = useState(false);
  const [frame, setFrame] = useState<PoseReviewFrame | null>(null);
  const [saved, setSaved] = useState<PoseReviewFrame[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<PoseJointName>("left_knee");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const drag = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const alive = useRef(true);
  const analysis = project.analysis;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function open() {
    if (opened) {
      if (dirty && !window.confirm(t("discard"))) return;
      setOpened(false); return;
    }
    setOpened(true); setBusy(true); setError(false);
    try {
      const result = await poseReviewApi.list(project.id);
      if (!alive.current) return;
      if (result.analysis_id !== project.analysis_id) throw new Error("stale");
      setSaved(result.frames);
    } catch { if (alive.current) setError(true); }
    finally { if (alive.current) setBusy(false); }
  }

  async function load(pts: number) {
    if (dirty && !window.confirm(t("discard"))) return;
    setBusy(true); setError(false); setNotice("");
    try {
      const result = await poseReviewApi.frame(project.id, project.analysis_id, pts);
      if (!alive.current) return;
      setFrame(result); setIndex(analysis!.frame_pts.indexOf(pts)); setDirty(false); setLoaded(false);
    } catch { if (alive.current) setError(true); }
    finally { if (alive.current) setBusy(false); }
  }

  function edit(next: PoseReviewFrame) { setFrame(next); setDirty(true); setNotice(""); }
  function position(x: number, y: number) {
    if (!frame || busy || !loaded) return;
    const joint = frame.joints[selected];
    edit({ ...frame, status: "draft", joints: { ...frame.joints, [selected]: {
      xy: [Math.max(0, Math.min(frame.width, x)), Math.max(0, Math.min(frame.height, y))], visibility: joint?.visibility ?? "uncertain",
    } } });
  }
  function pointer(e: React.PointerEvent<SVGSVGElement>) {
    // getScreenCTM accounts for SVG letterboxing as well as responsive scaling.
    const matrix = e.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = e.currentTarget.createSVGPoint(); point.x = e.clientX; point.y = e.clientY;
    const local = point.matrixTransform(matrix.inverse()); position(local.x, local.y);
  }
  async function save() {
    if (!frame) return;
    setBusy(true); setError(false);
    try {
      const result = await poseReviewApi.save(project.id, frame);
      if (!alive.current) return;
      setFrame(result); setDirty(false); setSaved(all => [...all.filter(f => f.pts !== result.pts), result].sort((a, b) => a.pts - b.pts)); setNotice(t("saved"));
    } catch { if (alive.current) setError(true); }
    finally { if (alive.current) setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: "recreation.pose-review.v1", project_id: project.id, analysis_id: project.analysis_id, frames: saved }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `${project.id}-pose-review.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!analysis) return null;
  const joint = frame?.joints[selected];
  return <section className="border-t border-border pt-4 space-y-3">
    <button type="button" className="glass-button min-h-11" aria-expanded={opened} onClick={() => void open()} disabled={busy}>{t("title")}</button>
    {opened && <>
      <p className="text-sm text-text-muted">{t("instructions")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">{t("sourceFrame")}<input aria-label={t("sourceFrame")} className="glass-input block w-28" type="number" min={1} max={analysis.frame_pts.length} value={index + 1} disabled={busy} onChange={e => setIndex(Math.max(0, Math.min(analysis.frame_pts.length - 1, Number(e.target.value) - 1 || 0)))} /></label>
        <span className="font-mono text-xs">{seconds(analysis, analysis.frame_pts[index]).toFixed(6)} s</span>
        <button className="glass-button min-h-11" disabled={busy} onClick={() => void load(analysis.frame_pts[index])}>{t("load")}</button>
        <button className="glass-button inline-flex min-h-11 items-center gap-2" disabled={!saved.length || busy} onClick={download}><Download size={16} />{t("export")}</button>
        {busy && <Loader2 className="animate-spin" size={18} aria-label={t("loading")} />}
      </div>
      {saved.length > 0 && <div className="flex flex-wrap gap-2" aria-label={t("savedFrames")}>{saved.map(f => <button className="glass-button min-h-11 text-sm" key={f.pts} disabled={busy} onClick={() => void load(f.pts)}>{t("frameLabel", { frame: f.source_frame })} · {t(`status.${f.status}`)}</button>)}</div>}
      {error && <p role="alert" className="text-sm text-red-400">{t("error")}</p>}
      {frame && <>
        <p className="text-sm">{t("frameLabel", { frame: frame.source_frame })} · {t(`status.${frame.status}`)}{dirty ? ` · ${t("unsaved")}` : ""}</p>
        <svg ref={svg} viewBox={`0 0 ${frame.width} ${frame.height}`} className="block w-full max-w-4xl bg-black touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" role="img" aria-label={t("editor")} tabIndex={0}
          onPointerDown={e => { if (busy || !loaded) return; drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); pointer(e); }}
          onPointerMove={e => { if (drag.current) pointer(e); }} onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
          onKeyDown={e => { if (!joint || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return; e.preventDefault(); const n = e.shiftKey ? 5 : 1; position(joint.xy[0] + (e.key === "ArrowRight" ? n : e.key === "ArrowLeft" ? -n : 0), joint.xy[1] + (e.key === "ArrowDown" ? n : e.key === "ArrowUp" ? -n : 0)); }}>
          <image key={frame.media_id} href={frame.image_url.startsWith("/") ? `${API_URL}${frame.image_url}` : frame.image_url} width={frame.width} height={frame.height} onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); setError(true); }} />
          {(["left", "right"] as const).map(side => {
            const color = side === "left" ? "#2dd4bf" : "#fb923c";
            return (["hip", "knee"] as const).map((part, i) => {
              const a = frame.joints[`${side}_${part}`], b = frame.joints[`${side}_${i === 0 ? "knee" : "ankle"}`];
              return a && b && <line key={`${side}-${part}`} x1={a.xy[0]} y1={a.xy[1]} x2={b.xy[0]} y2={b.xy[1]} stroke={color} strokeWidth={3} strokeDasharray={a.visibility !== "visible" || b.visibility !== "visible" ? "6 4" : undefined} pointerEvents="none" />;
            });
          })}
          {poseJoints.map(n => { const p = frame.joints[n]; return p && <g key={n} pointerEvents="none"><circle cx={p.xy[0]} cy={p.xy[1]} r={n === selected ? 7 : 5} stroke={n === selected ? "#fbbf24" : n.startsWith("left") ? "#2dd4bf" : "#fb923c"} strokeWidth={2} fill="none" /><text x={p.xy[0] + 10} y={p.xy[1]} fill="white" stroke="black" strokeWidth={2} paintOrder="stroke" fontSize={13}>{t(`joints.${n}`)}</text></g>; })}
        </svg>
        <p className="text-xs text-text-muted">{t("legend")}</p>
        <div className="flex flex-wrap gap-2">{poseJoints.map(n => <button key={n} className={`glass-button min-h-11 ${selected === n ? "ring-2 ring-primary" : ""}`} aria-pressed={selected === n} disabled={busy} onClick={() => setSelected(n)}>{t(`joints.${n}`)}{frame.joints[n] ? " ✓" : ""}</button>)}</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">{t("visibilityLabel", { joint: t(`joints.${selected}`) })}<select className="glass-input block" value={joint?.visibility ?? "uncertain"} disabled={busy || !joint} onChange={e => { if (joint) edit({ ...frame, status: "draft", joints: { ...frame.joints, [selected]: { ...joint, visibility: e.target.value as PoseVisibility } } }); }}>{["uncertain", "visible", "occluded"].map(v => <option key={v} value={v}>{t(`visibility.${v}`)}</option>)}</select></label>
          <label className="text-sm">{t("contactLabel")}<select className="glass-input block" value={frame.contact} disabled={busy} onChange={e => edit({ ...frame, contact: e.target.value as PoseReviewFrame["contact"] })}>{["uncertain", "left", "right", "both", "airborne"].map(v => <option key={v} value={v}>{t(`contact.${v}`)}</option>)}</select></label>
          <label className="text-sm">{t("depthLabel")}<select className="glass-input block" value={frame.depth_order} disabled={busy} onChange={e => edit({ ...frame, status: "draft", depth_order: e.target.value as PoseReviewFrame["depth_order"] })}>{["uncertain", "left_front", "right_front"].map(v => <option key={v} value={v}>{t(`depth.${v}`)}</option>)}</select></label>
          <label className="text-sm">{t("statusLabel")}<select className="glass-input block" value={frame.status} disabled={busy} onChange={e => edit({ ...frame, status: e.target.value as PoseReviewFrame["status"] })}>{["draft", "reviewed", "not_evaluable"].map(v => <option key={v} value={v}>{t(`status.${v}`)}</option>)}</select></label>
          <button className="glass-button inline-flex min-h-11 items-center gap-2" disabled={busy || !dirty || !loaded} onClick={() => void save()}><Save size={16} />{t("save")}</button>
        </div>
        <p role="status" className="text-sm text-text-muted">{notice || t("noRecompute")}</p>
      </>}
    </>}
  </section>;
}
