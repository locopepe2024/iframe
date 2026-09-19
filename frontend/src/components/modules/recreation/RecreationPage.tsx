"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Film, Loader2, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import axios from "axios";
import { API_URL } from "@/lib/api";
import { CutEvidence, importCuts, recreationApi, RecreationProject, seconds } from "@/lib/recreation";
import ShotReferences from "./ShotReferences";
import WhiteModelReference from "./WhiteModelReference";

const media = (path: string) => path.startsWith("/") ? `${API_URL}${path}` : path;

export default function RecreationPage() {
  const t = useTranslations("recreation");
  const [projects, setProjects] = useState<RecreationProject[]>([]);
  const [project, setProject] = useState<RecreationProject | null>(null);
  const [cuts, setCuts] = useState<number[]>([]);
  const [evidence, setEvidence] = useState<Record<number, CutEvidence>>({});
  const [frameIndex, setFrameIndex] = useState(1);
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const activeId = useRef<string | null>(null);
  const analysis = project?.analysis;
  const processing = project?.status === "queued" || project?.status === "analyzing";
  const dirty = project?.status === "confirmed" && JSON.stringify(cuts) !== JSON.stringify(project.timeline?.cuts.map(c => c.pts));

  const report = (err: unknown) => setError(axios.isAxiosError(err)
    ? (typeof err.response?.data?.detail === "string" ? err.response.data.detail : t("requestFailed"))
    : err instanceof Error && (err.message === "invalidTimeline" || err.message === "oversized") ? t(err.message) : t("requestFailed"));

  function open(record: RecreationProject) {
    activeId.current = record.id;
    setProject(record);
    setCuts(record.timeline?.cuts.map(c => c.pts) ?? record.analysis?.candidates.map(c => c.pts) ?? []);
    setEvidence(Object.fromEntries([...(record.analysis?.candidates ?? []), ...Object.values(record.analysis?.manual_evidence ?? {})].map(c => [c.pts, c])));
    setFrameIndex(1); setImportText(""); setError("");
    setProjects(all => [record, ...all.filter(p => p.id !== record.id)]);
  }

  useEffect(() => {
    let alive = true;
    recreationApi.list().then(records => { if (alive) setProjects(records); })
      .catch(err => { if (alive) report(err); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; activeId.current = null; };
    // Only initial loading; subsequent refreshes preserve the active draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!project || !processing) return;
    let alive = true;
    const id = project.id;
    const timer = setInterval(() => {
      recreationApi.get(id).then(record => {
        if (!alive || activeId.current !== id) return;
        if (record.status === "queued" || record.status === "analyzing") setProject(record);
        else open(record);
      }).catch(err => { if (alive) report(err); });
    }, 2000);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, processing]);

  async function act(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (err) { report(err); } finally { setBusy(false); }
  }

  async function chooseCut(pts: number) {
    if (!project || !analysis || cuts.includes(pts)) return;
    const pair = evidence[pts] ?? await recreationApi.evidence(project, pts);
    setEvidence(all => ({ ...all, [pts]: pair }));
    setCuts(all => [...all, pts].sort((a, b) => a - b));
  }

  return <div className="h-full overflow-y-auto p-4 md:p-8 text-foreground">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Film size={22} />{t("title")}</h1>
      <button className="glass-button flex items-center gap-2" disabled={busy} onClick={() => file.current?.click()}>
        <Upload size={16} />{t("upload")}
      </button>
      <input ref={file} type="file" accept=".mp4,.mov,.webm,.mkv" className="hidden" aria-label={t("upload")}
        onChange={event => { const selected = event.target.files?.[0]; event.target.value = "";
          if (selected) void act(async () => {
            if (selected.size > 256 * 1024 * 1024) throw new Error("oversized");
            open(await recreationApi.upload(selected));
          }); }} />
    </header>
    {error && <div role="alert" className="my-4 border-l-2 border-red-400 pl-3 text-sm text-red-400 break-words">{error}</div>}
    <div className="grid gap-6 mt-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="min-w-0">
        <h2 className="text-sm font-semibold mb-3">{t("sources")}</h2>
        {loading && <Loader2 className="animate-spin" size={18} aria-label={t("loading")} />}
        {!loading && projects.length === 0 && <p className="text-sm text-text-muted">{t("empty")}</p>}
        <ul className="space-y-1">{projects.map(p => <li key={p.id}>
          <button disabled={busy} className={`w-full text-left p-3 rounded-md ${project?.id === p.id ? "bg-primary/10" : "hover:bg-hover-bg"}`}
            onClick={() => void act(async () => open(await recreationApi.get(p.id)))}>
            <span className="block text-sm break-words">{p.title}</span>
            <span className="text-xs text-text-muted">{t(p.status)}</span>
          </button>
        </li>)}</ul>
      </aside>
      <main className="min-w-0">
        {!project ? <div className="py-16 text-center text-text-muted">{t("selectSource")}</div> : <>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="min-w-0"><h2 className="text-lg font-semibold break-words">{project.title}</h2>
              <p className="text-sm text-text-muted">{t(dirty ? "unsaved" : project.status)}</p></div>
            <div className="flex gap-2">
              <button className="glass-button p-2" title={t("refresh")} aria-label={t("refresh")} disabled={busy}
                onClick={() => void act(async () => open(await recreationApi.get(project.id)))}><RefreshCw size={16} /></button>
              {!analysis && <button className="glass-button flex items-center gap-2" disabled={busy || processing}
                onClick={() => void act(async () => open(await recreationApi.analyze(project)))}>
                {processing ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}{t("analyze")}</button>}
            </div>
          </div>
          <video ref={video} src={media(project.source_url)} controls preload="metadata"
            className="w-full max-h-[420px] aspect-video bg-black object-contain" />
          <WhiteModelReference />
          {project.error && <p role="alert" className="text-red-400 text-sm py-3 break-words">{project.error}</p>}
          {analysis && <>
            <p className="text-xs text-text-muted py-3">{analysis.width} × {analysis.height} · {analysis.duration_seconds.toFixed(6)} s · {t("audioTracks", { count: analysis.audio_streams })}</p>
            <section className="border-t border-border py-5">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <h3 className="font-semibold">{t("timeline")} · {cuts.length + 1} {t("shots")}</h3>
                <button className="glass-button flex items-center gap-2" disabled={busy}
                  onClick={() => void act(async () => open(await recreationApi.confirm(project, cuts)))}><Check size={16} />{t("confirm")}</button>
              </div>
              <div className="flex flex-wrap gap-3 items-end mb-4">
                <label className="text-sm flex-1 min-w-[180px]">{t("frame")}
                  <input type="range" min={1} max={analysis.frame_pts.length - 1} value={frameIndex}
                    disabled={analysis.frame_pts.length < 2 || busy} className="w-full block mt-2"
                    onChange={e => { const index = Number(e.target.value); setFrameIndex(index);
                      if (video.current) video.current.currentTime = seconds(analysis, analysis.frame_pts[index]); }} />
                </label>
                <input type="number" min={1} max={analysis.frame_pts.length - 1} value={frameIndex} aria-label={t("frame")}
                  className="glass-input w-24" disabled={busy || analysis.frame_pts.length < 2}
                  onChange={e => setFrameIndex(Math.max(1, Math.min(analysis.frame_pts.length - 1, Number(e.target.value))))} />
                <span className="font-mono text-sm w-28">{analysis.frame_pts[frameIndex] !== undefined ? seconds(analysis, analysis.frame_pts[frameIndex]).toFixed(6) : "0"} s</span>
                <button className="glass-button p-2" title={t("addCut")} aria-label={t("addCut")}
                  disabled={busy || analysis.frame_pts.length < 2 || cuts.length >= 120}
                  onClick={() => void act(() => chooseCut(analysis.frame_pts[frameIndex]))}><Plus size={18} /></button>
              </div>
              <div className="flex flex-wrap gap-2 mb-5">
                <input className="glass-input flex-1 min-w-[180px]" value={importText} onChange={e => setImportText(e.target.value)}
                  aria-label={t("timestamps")} placeholder="4.016667, 9.083333, 10.400000" />
                <button className="glass-button" disabled={busy} onClick={() => void act(async () => {
                  const imported = importCuts(importText, analysis);
                  setCuts(imported);
                })}>{t("import")}</button>
              </div>
              {cuts.length === 0 && <p className="text-text-muted text-sm py-3">{t("noCuts")}</p>}
              <ol className="divide-y divide-border">{cuts.map((pts, i) => {
                const pair = evidence[pts];
                return <li key={pts} className="py-4">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-sm font-mono">{i + 1} · {seconds(analysis, pts).toFixed(6)} s</span>
                    <span className="text-xs text-text-muted">{t(analysis.candidates.some(c => c.pts === pts) ? "detected" : "manual")}</span>
                    <button className="ml-auto p-2 hover:bg-hover-bg rounded" title={t("remove")} aria-label={t("remove")} disabled={busy}
                      onClick={() => setCuts(all => all.filter(p => p !== pts))}><Trash2 size={16} /></button>
                  </div>
                  {pair ? <div className="grid grid-cols-2 gap-3 max-w-2xl">
                    {[pair.before_url, pair.after_url].map((url, index) => <figure key={url} className="min-w-0">
                      <img src={media(url)} alt={t(index ? "after" : "before")} className="w-full aspect-video object-contain bg-black" />
                      <figcaption className="text-xs text-text-muted mt-1">{t(index ? "after" : "before")} · {seconds(analysis, index ? pts : pair.before_pts).toFixed(6)} s</figcaption>
                    </figure>)}
                  </div> : <button className="glass-button text-sm" disabled={busy} onClick={() => void act(async () => {
                    const pair = await recreationApi.evidence(project, pts); setEvidence(all => ({ ...all, [pts]: pair }));
                  })}>{t("evidence")}</button>}
                </li>;
              })}</ol>
            </section>
            {project.status === "confirmed" && project.timeline && <ShotReferences key={`${project.id}:${project.analysis_id}:${project.timeline.shots.map(s => s.id).join(",")}`} project={project} disabled={busy || !!dirty} onSaved={record => {
              setProject(record); setProjects(all => all.map(p => p.id === record.id ? record : p));
            }} />}
            <details className="border-t border-border py-4"><summary className="cursor-pointer text-sm">{t("contactSheet")}</summary>
              <img src={media(analysis.contact_sheet_url)} alt={t("contactSheet")} className="w-full mt-4" /></details>
          </>}
        </>}
      </main>
    </div>
  </div>;
}
