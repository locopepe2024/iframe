"use client";

import { ReactNode, useEffect, useState } from "react";
import { AlertCircle, Check, Download, FileInput, Plus, Save } from "lucide-react";
import { useLocale } from "next-intl";
import { API_URL } from "@/lib/api";
import { recreationApi, RecreationProject, RecreationShot, seconds, ShotReview, ShotReviewDecision, ShotReviewItem } from "@/lib/recreation";
import DetailReviewPanel from "./DetailReviewPanel";

const decisions: ShotReviewDecision[] = ["pending", "accept", "edit", "reject", "unknown"];
const label = {
  zh: { title: "拉片审核时间线", import: "导入解析 JSON", save: "保存审核", export: "导出审核", empty: "可逐镜头新增人工标注，或导入解析结果。", add: "新增人工标注", stale: "切点已改变，旧审核仅可查看。请重新导入当前镜头的解析结果。", pending: "待审核", accept: "确认", edit: "修订", reject: "驳回", unknown: "未知", cut_scene: "切点 / 场景", camera: "机位 / 运镜", optics: "镜头 / 景别", scene: "场景", object: "物体线索", action: "动作", uncertainty: "未决项", candidate: "模型候选", correction: "人工标注 / 修订", evidence: "证据帧", source: "模型原文", shot: "镜头", first: "起始帧", last: "结束帧", evidenceInput: "证据帧号（逗号分隔）", loaded: "审核已保存", invalid: "无法读取解析 JSON", conflict: "保存冲突，请刷新项目后重试", current: "当前帧", setFirst: "设为起始", setLast: "设为结束", addEvidence: "加入证据", locate: "定位", support: "支撑脚", contact: "脚底接触类型", needsReview: "待审核", left: "左脚", right: "右脚", both: "双脚", airborne: "腾空", full_sole: "全脚掌", forefoot: "前脚掌", toe: "脚尖", rolling: "滚动", unknownValue: "无法判断" },
  en: { title: "Shot review timeline", import: "Import analysis JSON", save: "Save review", export: "Export review", empty: "Add a manual annotation to a shot, or import analysis.", add: "Add manual annotation", stale: "Cuts changed. This review is read-only; import analysis for the current shots.", pending: "Pending", accept: "Accept", edit: "Edit", reject: "Reject", unknown: "Unknown", cut_scene: "Cut / scene", camera: "Camera movement", optics: "Lens / scale", scene: "Scene", object: "Object clue", action: "Action", uncertainty: "Unresolved", candidate: "Model candidate", correction: "Human annotation / correction", evidence: "Evidence frames", source: "Model source", shot: "Shot", first: "First frame", last: "Last frame", evidenceInput: "Evidence frames (comma separated)", loaded: "Review saved", invalid: "Could not read analysis JSON", conflict: "Save conflict; refresh the project", current: "Current frame", setFirst: "Set start", setLast: "Set end", addEvidence: "Add evidence", locate: "Locate", support: "Support foot", contact: "Sole contact type", needsReview: "Needs review", left: "Left", right: "Right", both: "Both", airborne: "Airborne", full_sole: "Full sole", forefoot: "Forefoot", toe: "Toe", rolling: "Rolling", unknownValue: "Cannot determine" },
};

export default function ShotReviewTimeline({ project, onSaved, seek, currentFrame, viewer }: {
  project: RecreationProject; onSaved: (record: RecreationProject) => void; seek: (frame: number) => void; currentFrame: number; viewer: ReactNode;
}) {
  const locale = useLocale().startsWith("zh") ? "zh" : "en";
  const t = label[locale];
  const [review, setReview] = useState<ShotReview | null>(null);
  const [key, setKey] = useState("");
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    recreationApi.getShotReview(project.id).then(result => {
      if (active) { setReview(result.review); setKey(result.timeline_key); setStale(result.stale); setSelectedId(result.review?.items.find(item => item.decision === "pending")?.id ?? result.review?.items[0]?.id ?? null); }
    }).catch(() => { if (active) setMessage(t.conflict); });
    return () => { active = false; };
  }, [project.id, project.timeline?.shots.map(shot => `${shot.id}:${shot.start_pts}:${shot.end_pts}`).join("|")]);

  const update = (id: string, field: "decision" | "edited_text" | "kind", value: string) => {
    setReview(current => current && { ...current, items: current.items.map(item => item.id === id ? { ...item, [field]: value } : item) });
    setMessage("");
  };

  const addManual = (shot: RecreationShot) => {
    const currentPts = project.analysis?.frame_pts[currentFrame - 1];
    const frame = currentPts !== undefined && currentPts >= shot.start_pts && currentPts < shot.end_pts
      ? currentFrame - 1 : project.analysis?.frame_pts.findIndex(pts => pts >= shot.start_pts) ?? -1;
    if (!shot.id || frame < 0) return;
    const item: ShotReviewItem = { id: `manual:${crypto.randomUUID()}`, kind: "object", shot_id: shot.id,
      frame_span: [frame + 1, frame + 1], evidence_frames: [frame + 1], candidate: "", edited_text: "",
      decision: "pending", actor_id: "", source: { provenance: "human" } };
    setReview(current => current ? { ...current, items: [...current.items, item] } : {
      schema_version: "shot-review.v1", analysis_id: project.analysis_id, source_fingerprint: project.source_fingerprint ?? "",
      timeline_key: key, review_revision: 0, items: [item], updated_at: 0,
    });
    setSelectedId(item.id);
    setMessage("");
  };

  const updateFrames = (id: string, field: "first" | "last" | "evidence", value: string) => {
    setReview(current => current && { ...current, items: current.items.map(item => {
      if (item.id !== id) return item;
      if (field === "evidence") return { ...item, evidence_frames: value.split(",").map(part => Number(part.trim())).filter(Number.isInteger) };
      const frame = Number(value);
      const span: [number, number] = field === "first" ? [frame, item.frame_span[1]] : [item.frame_span[0], frame];
      return { ...item, frame_span: span };
    }) });
    setMessage("");
  };

  const useCurrentFrame = (item: ShotReviewItem, field: "first" | "last" | "evidence") => {
    const pts = project.analysis?.frame_pts[currentFrame - 1];
    const shot = project.timeline?.shots.find(row => row.id === item.shot_id);
    if (pts === undefined || !shot || pts < shot.start_pts || pts >= shot.end_pts) return;
    setReview(current => current && { ...current, items: current.items.map(row => {
      if (row.id !== item.id) return row;
      if (field === "first") {
        return { ...row, frame_span: [currentFrame, Math.max(currentFrame, row.frame_span[1])] as [number, number], evidence_frames: row.evidence_frames.filter(n => n >= currentFrame) };
      }
      if (field === "last") {
        return { ...row, frame_span: [Math.min(currentFrame, row.frame_span[0]), currentFrame] as [number, number], evidence_frames: row.evidence_frames.filter(n => n <= currentFrame) };
      }
      return currentFrame >= row.frame_span[0] && currentFrame <= row.frame_span[1]
        ? { ...row, evidence_frames: Array.from(new Set([...row.evidence_frames, currentFrame])).sort((a, b) => a - b) } : row;
    }) });
    setMessage("");
  };

  async function save(update: { items: ShotReviewItem[] } | { candidate: Record<string, unknown> }) {
    setBusy(true); setMessage("");
    try {
      const record = await recreationApi.saveShotReview(project, key, stale ? 0 : review?.review_revision ?? 0, update);
      setReview(record.shot_review ?? null); setStale(false); onSaved(record); setMessage(t.loaded);
    } catch (error) { setMessage(error instanceof Error ? error.message : t.conflict); }
    finally { setBusy(false); }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const candidate = JSON.parse(await file.text()) as Record<string, unknown>;
      await save({ candidate });
    } catch (error) { setMessage(error instanceof Error ? error.message : t.invalid); }
  }

  async function freezeMacro() {
    if (!review) return;
    setBusy(true); setMessage("");
    try {
      const record = await recreationApi.freezeMacroReview(project, key, review.review_revision);
      onSaved(record); setMessage(locale === "zh" ? "一审已冻结" : "Macro review frozen");
    } catch (error) { setMessage(error instanceof Error ? error.message : t.conflict); }
    finally { setBusy(false); }
  }

  function exportReview() {
    if (!review) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...review, stale }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${project.id}-shot-review.json`; link.click();
    URL.revokeObjectURL(url);
  }

  const groups = project.timeline?.shots.map((shot, index) => ({ shot, index, items: review?.items.filter(item => item.shot_id === shot.id) ?? [] })) ?? [];
  const missingShots = groups.filter(group => group.items.length === 0);
  const pendingItems = review?.items.filter(item => item.decision === "pending") ?? [];
  const unknownItems = review?.items.filter(item => item.decision === "unknown") ?? [];
  const macroReady = Boolean(review && review.items.length > 0 && missingShots.length === 0 && pendingItems.length === 0);
  const framePts = project.analysis?.frame_pts[currentFrame - 1];
  const activeGroup = groups.find(({ shot }) => framePts !== undefined && framePts >= shot.start_pts && framePts < shot.end_pts) ?? groups[0];
  const visibleGroups = activeGroup ? [activeGroup] : [];
  const activeItemId = activeGroup?.items.some(item => item.id === selectedId) ? selectedId
    : activeGroup?.items.find(item => item.decision === "pending")?.id ?? activeGroup?.items[0]?.id ?? null;
  const firstFrame = (shot: RecreationShot) => Math.max(1, (project.analysis?.frame_pts.findIndex(pts => pts >= shot.start_pts) ?? 0) + 1);
  const sampleFrame = (pts: number) => {
    const frames = project.analysis?.frame_pts ?? [];
    if (!frames.length) return 1;
    return frames.reduce((nearest, value, index) => Math.abs(value - pts) < Math.abs(frames[nearest] - pts) ? index : nearest, 0) + 1;
  };
  const media = (path: string) => path.startsWith("/") ? `${API_URL}${path}` : path;
  return <section aria-label={t.title} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold">{t.title}</h3>{review && <span className="text-xs text-text-muted">{locale === "zh" ? "一审" : "Macro"} v{review.review_revision} · {review.items.filter(item => item.decision !== "pending").length}/{review.items.length}{project.macro_review?.macro_revision === review.review_revision && <span className="ml-2">{locale === "zh" ? "已冻结" : "Frozen"}</span>}</span>}</div>
      <div className="flex flex-wrap gap-2">
        <label className="glass-button inline-flex min-h-10 cursor-pointer items-center gap-2"><FileInput size={16} />{t.import}<input type="file" accept="application/json,.json" className="sr-only" disabled={busy || stale} onChange={e => void importFile(e.target.files?.[0])} /></label>
        <button type="button" className="glass-button inline-flex min-h-10 items-center gap-2" disabled={!review || stale || busy} onClick={() => review && void save({ items: review.items })}><Save size={16} />{t.save}</button>
        <button type="button" className="glass-button inline-flex min-h-10 items-center gap-2" disabled={!macroReady || stale || busy || JSON.stringify(review) !== JSON.stringify(project.shot_review)} onClick={() => void freezeMacro()}><Check size={16} />{locale === "zh" ? "冻结一审" : "Freeze macro"}</button>
        <button type="button" className="glass-button inline-flex min-h-10 items-center gap-2" disabled={!review} onClick={exportReview}><Download size={16} />{t.export}</button>
      </div>
    </div>
    {stale && <p role="alert" className="text-amber-300 text-sm">{t.stale}</p>}
    {message && <p role="status" className="text-sm text-text-muted break-words">{message}</p>}
    <div className="border-t border-border pt-3" aria-label={locale === "zh" ? "人工审核清单" : "Human review queue"}>
      <div className="flex items-center gap-2 text-sm font-medium"><AlertCircle size={16} aria-hidden="true" />{locale === "zh" ? "人工审核清单" : "Human review queue"}</div>
      <p className="mt-1 text-xs text-text-muted">{locale === "zh"
        ? `${missingShots.length} 个镜头缺少标注 · ${pendingItems.length} 项待判定 · ${unknownItems.length} 项保留未知`
        : `${missingShots.length} shots without annotations · ${pendingItems.length} pending decisions · ${unknownItems.length} unresolved decisions`}</p>
      {missingShots.length + pendingItems.length + unknownItems.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">
        {missingShots.map(({ shot, index }) => <button key={shot.id} type="button" className="glass-button min-h-9 px-3 text-left text-xs" onClick={() => seek(firstFrame(shot))}>{locale === "zh" ? `镜头 ${index + 1}：缺少标注` : `Shot ${index + 1}: no annotations`}</button>)}
        {[...pendingItems, ...unknownItems].map(item => <button key={item.id} type="button" className="glass-button min-h-9 px-3 text-left text-xs" onClick={() => { setSelectedId(item.id); seek(item.frame_span[0]); }}>
          {item.frame_span[0]}–{item.frame_span[1]} · {t[item.kind]} · {item.decision === "pending" ? t.pending : t.unknown}
        </button>)}
      </div> : <p className="mt-2 text-xs text-text-muted">{locale === "zh" ? "现有审核项均已判定，且每个镜头有标注。" : "Existing items are decided and every shot has an annotation."}</p>}
    </div>
    <p className="text-xs text-text-muted">{t.current} <span className="font-mono text-foreground">{currentFrame} · {project.analysis && seconds(project.analysis, project.analysis.frame_pts[currentFrame - 1]).toFixed(6)} s</span></p>
    {!review && <p className="text-sm text-text-muted">{t.empty}</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(170px,210px)_minmax(0,1fr)_minmax(340px,0.85fr)]">
      <aside className="min-w-0 border-t border-border pt-3 xl:max-h-[70vh] xl:overflow-y-auto" aria-label={t.shot}>
        <h4 className="mb-2 text-xs font-semibold text-text-muted">{t.shot} · {groups.length}</h4>
        <ol className="flex gap-1 overflow-x-auto pb-2 xl:block xl:space-y-1 xl:overflow-visible xl:pb-0">{groups.map(({ shot, index, items }) => {
          const active = activeGroup?.shot.id === shot.id;
          return <li key={shot.id} className="shrink-0 xl:shrink"><button type="button" aria-current={active ? "true" : undefined}
            className={`w-full min-w-36 border-l-2 px-3 py-2 text-left text-xs ${active ? "border-primary bg-primary/10 text-foreground" : "border-transparent text-text-muted hover:bg-hover-bg"}`}
            onClick={() => seek(firstFrame(shot))}>
            <span className="block font-semibold">{t.shot} {index + 1}</span>
            <span className="block font-mono tabular-nums">{project.analysis && seconds(project.analysis, shot.start_pts).toFixed(3)}–{project.analysis && seconds(project.analysis, shot.end_pts).toFixed(3)}s</span>
            <span className="block truncate">{items.length === 0 ? (locale === "zh" ? "缺少标注" : "No annotations") : `${items.length} ${t.candidate} · ${items.filter(item => item.decision === "pending").length} ${t.pending}`}</span>
          </button></li>;
        })}</ol>
      </aside>
      <div className="min-w-0 xl:sticky xl:top-20">{viewer}</div>
      <div className="min-w-0 space-y-5">{visibleGroups.map(({ shot, index, items }) => <div key={shot.id} className="border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{t.shot} {index + 1} · {project.analysis && seconds(project.analysis, shot.start_pts).toFixed(3)}–{project.analysis && seconds(project.analysis, shot.end_pts).toFixed(3)}s</h4>
        <button type="button" className="glass-button inline-flex min-h-9 items-center gap-1 text-sm" disabled={stale || busy} onClick={() => addManual(shot)}><Plus size={16} />{t.add}</button></div>
      <div className="space-y-3">
        {items.filter(item => item.id === activeItemId).map(item => <article key={item.id} className={`border rounded-md p-3 space-y-2 ${currentFrame >= item.frame_span[0] && currentFrame <= item.frame_span[1] ? "border-primary/60" : "border-border"}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">{item.source.provenance === "human" ? <select aria-label={t.title} className="glass-input text-foreground" value={item.kind} disabled={stale} onChange={e => update(item.id, "kind", e.target.value)}>{(["object", "action", "camera", "optics", "scene", "cut_scene"] as const).map(kind => <option key={kind} value={kind}>{t[kind]}</option>)}</select> : <span className="font-semibold text-foreground">{t[item.kind]}</span>}<button type="button" className="text-left hover:text-foreground break-all" title={t.locate} onClick={() => seek(item.frame_span[0])}>#{item.id}</button><span>{item.frame_span[0]}–{item.frame_span[1]}</span>{item.actor_id && <span>{item.actor_id}</span>}</div>
        {item.candidate && <p className="text-sm"><span className="text-text-muted">{t.candidate}: </span>{item.candidate}</p>}
        <div className="flex flex-wrap gap-1 items-center text-xs"><span className="text-text-muted mr-1">{t.evidence}</span>{item.evidence_frames.map(frame => <button type="button" key={frame} className="glass-button px-2 py-1 font-mono" onClick={() => seek(frame)}>{frame} · {project.analysis && seconds(project.analysis, project.analysis.frame_pts[frame - 1]).toFixed(3)}s</button>)}</div>
        <div className="flex flex-wrap gap-3 text-xs text-text-muted">
          <label>{t.first}<input type="number" min="1" className="glass-input block mt-1 w-24 text-foreground" value={item.frame_span[0]} disabled={stale} onChange={e => updateFrames(item.id, "first", e.target.value)} /></label>
          <label>{t.last}<input type="number" min="1" className="glass-input block mt-1 w-24 text-foreground" value={item.frame_span[1]} disabled={stale} onChange={e => updateFrames(item.id, "last", e.target.value)} /></label>
          <label>{t.evidenceInput}<input type="text" className="glass-input block mt-1 min-w-[180px] text-foreground" value={item.evidence_frames.join(", ")} disabled={stale} onChange={e => updateFrames(item.id, "evidence", e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">{(["first", "last", "evidence"] as const).map(field => <button key={field} type="button" className="glass-button min-h-8 px-2" disabled={stale || busy} onClick={() => useCurrentFrame(item, field)}>{field === "first" ? t.setFirst : field === "last" ? t.setLast : t.addEvidence}</button>)}</div>
        <div className="flex flex-wrap items-end gap-3"><label className="text-xs text-text-muted">{t.correction}<textarea className="glass-input block mt-1 w-full min-w-[220px] min-h-16 text-sm text-foreground" value={item.edited_text} disabled={stale} onChange={e => update(item.id, "edited_text", e.target.value)} /></label>
          <label className="text-xs text-text-muted">{t.title}<select className="glass-input block mt-1 min-h-10 text-sm text-foreground" value={item.decision} disabled={stale} onChange={e => update(item.id, "decision", e.target.value)}>{decisions.map(value => <option key={value} value={value}>{t[value]}</option>)}</select></label></div>
        {item.source.provenance !== "human" && <details className="text-xs text-text-muted"><summary className="cursor-pointer">{t.source}</summary><pre className="mt-2 whitespace-pre-wrap break-words">{JSON.stringify(item.source, null, 2)}</pre></details>}
      </article>)}</div>
    </div>)}</div>
    </div>
    <DetailReviewPanel project={project} timelineKey={key} onSaved={onSaved} seek={seek} />
    <nav aria-label={t.title} className="border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between text-xs text-text-muted"><span>{t.shot} · {groups.length}</span><span>{t.current} {currentFrame}/{project.analysis?.frame_pts.length ?? 0}</span></div>
      {project.analysis?.samples?.length ? <div className="mb-1 flex gap-1 overflow-x-auto pb-1" aria-label={locale === "zh" ? "时间线联系表" : "Timeline contact sheet"}>
        {groups.map(({ shot, index }) => {
          const start = firstFrame(shot);
          const next = groups[index + 1];
          const end = next ? firstFrame(next.shot) - 1 : project.analysis?.frame_pts.length ?? start;
          const samples = project.analysis?.samples?.filter(sample => sample.pts >= shot.start_pts && sample.pts < shot.end_pts) ?? [];
          return <div key={shot.id} className="flex min-w-32 gap-0.5 bg-black/30" style={{ flexGrow: Math.max(1, end - start + 1) }}>
            {samples.map(sample => {
              const frame = sampleFrame(sample.pts);
              return <button key={sample.pts} type="button" className="relative min-w-0 flex-1 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                title={`${t.current} ${frame}`} aria-label={`${t.current} ${frame}`} onClick={() => seek(frame)}>
                <img loading="lazy" decoding="async" src={media(sample.preview_url || sample.url)} alt="" className="h-16 w-full object-cover" />
                <span className="absolute bottom-0 left-0 bg-black/75 px-1 font-mono text-[10px] text-white">{frame}</span>
              </button>;
            })}
          </div>;
        })}
      </div> : project.analysis?.contact_sheet_url && <img loading="lazy" decoding="async" src={media(project.analysis.contact_sheet_preview_url || project.analysis.contact_sheet_url)} alt={locale === "zh" ? "时间线联系表" : "Timeline contact sheet"} className="mb-2 max-h-32 w-full object-contain object-left" />}
      <div className="flex min-h-20 gap-1 overflow-x-auto pb-2">{groups.map(({ shot, index, items }) => {
        const start = firstFrame(shot);
        const next = groups[index + 1];
        const end = next ? firstFrame(next.shot) - 1 : project.analysis?.frame_pts.length ?? start;
        const active = activeGroup?.shot.id === shot.id;
        return <button key={shot.id} type="button" aria-current={active ? "true" : undefined}
          className={`relative min-w-32 border px-3 py-2 text-left text-xs transition-colors ${active ? "border-primary bg-primary/10 text-foreground" : "border-border text-text-muted hover:bg-hover-bg"}`}
          style={{ flexGrow: Math.max(1, end - start + 1) }} onClick={() => seek(start)}>
          <span className="block font-semibold">{t.shot} {index + 1}</span>
          <span className="font-mono tabular-nums">{start}–{end}</span>
          <span className="mt-1 block truncate">{items.length} {t.candidate}</span>
          {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" style={{ width: `${Math.max(0, Math.min(100, ((currentFrame - start + 1) / Math.max(1, end - start + 1)) * 100))}%` }} />}
        </button>;
      })}</div>
      <div className="mt-2 flex gap-1 overflow-x-auto pb-2">{review?.items.slice().sort((a, b) => a.frame_span[0] - b.frame_span[0]).map(item => <button key={item.id} type="button"
        aria-pressed={activeItemId === item.id} className={`shrink-0 border px-2 py-1 text-left text-xs ${activeItemId === item.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-text-muted hover:bg-hover-bg"}`}
        onClick={() => { setSelectedId(item.id); seek(item.frame_span[0]); }}>
        <span className="font-mono tabular-nums">{item.frame_span[0]}–{item.frame_span[1]}</span> · {t[item.kind]} · {t[item.decision]}
      </button>)}</div>
    </nav>
  </section>;
}
