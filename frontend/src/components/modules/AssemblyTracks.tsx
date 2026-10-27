"use client";
import { useState } from "react";
import { useLocale } from "next-intl";
import { api, type AssemblyEditPlan } from "@/lib/api";
import type { Project } from "@/store/projectStore";
import { extractErrorDetail } from "@/lib/utils";

export function AssemblyTracks({ plan, resourceId, onChange, saved, project }: {
    plan: AssemblyEditPlan; resourceId: string; saved: boolean; project: Project;
    onChange: (plan: AssemblyEditPlan) => void;
}) {
    const zh = useLocale().startsWith("zh");
    const t = (cn: string, en: string) => zh ? cn : en;
    const [position, setPosition] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const control = "min-h-11 rounded-md border border-glass-border bg-elevated px-3 py-2 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40";
    const active = plan.lanes.filter(l => l.kind === "subtitle" && !l.muted).flatMap(l => l.clips.filter(c => c.enabled && c.timeline_start_ms <= position && position < c.timeline_end_ms));
    const download = async (id: string) => {
        setBusy(true); setError(null);
        try {
            const blob = await api.exportAssemblySubtitles(plan.scope, resourceId, id);
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = "subtitles.srt"; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) { setError(extractErrorDetail(e)); } finally { setBusy(false); }
    };
    return <section aria-label={t("多泳道编辑", "Multitrack editing")} className="space-y-3 rounded-lg border border-glass-border p-3">
        <div className="flex flex-wrap gap-2">{(["subtitle", "dialogue", "bgm", "sfx"] as const).map(kind => <button key={kind} className={control} type="button" disabled={plan.lanes.length >= 8} onClick={() => onChange({ ...plan, lanes: [...plan.lanes, { id: `${kind}-${crypto.randomUUID()}`, kind, label: kind, clips: [], allow_overlap: kind !== "subtitle" }] })}>{t("添加", "Add")} {kind}</button>)}</div>
        <label className="block text-xs text-text-secondary">{t("字幕时间预览", "Subtitle time preview")} · {(position / 1000).toFixed(2)}s<input className="block w-full accent-primary" type="range" aria-label={t("字幕播放头", "Subtitle playhead")} min={0} max={plan.target_duration_ms} step={10} value={position} onChange={e => setPosition(Number(e.target.value))} /></label>
        <div className="min-h-12 whitespace-pre-wrap rounded bg-elevated p-3 text-center text-foreground">{active.map(c => c.text).join("\n") || t("当前无字幕", "No caption at this time")}</div>
        <p className="text-xs text-text-muted">{t("字幕独立下载为 SRT，不烧录进视频。修改后先保存再下载。", "Subtitles download separately as SRT. Save changes before downloading.")}</p>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {plan.lanes.map(lane => <div key={lane.id} className="space-y-2 border-t border-glass-border pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary"><span>{lane.label || lane.kind}</span>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={Boolean(lane.muted)} onChange={e => onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, muted: e.target.checked } : l) })} />{t("静音 / 隐藏", "Mute / hide")}</label>
                {lane.kind !== "video" && <button type="button" className={control} onClick={() => onChange({ ...plan, lanes: plan.lanes.filter(l => l.id !== lane.id) })}>{t("移除泳道", "Remove lane")}</button>}
                {(["dialogue", "bgm", "sfx"] as string[]).includes(lane.kind) && <label>{t("添加项目音频", "Add project audio")}
                    <select className={control} value="" onChange={e => {
                        if (!e.target.value) return;
                        const sourceId = e.target.value;
                        const start = Math.min(position, plan.target_duration_ms - 1);
                        onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: [...l.clips, {
                            id: crypto.randomUUID(), timeline_start_ms: start, timeline_end_ms: Math.min(start + 2000, plan.target_duration_ms),
                            source_start_ms: 0, source_project_id: project.id,
                            source_frame_id: lane.kind === "bgm" ? undefined : sourceId,
                            source_refs: [`project:${project.id}:${sourceId}`], label: sourceId, enabled: true, gain: 1,
                        }] } : l) });
                    }}><option value="">{t("选择来源", "Select source")}</option>
                        {lane.kind === "bgm" ? (project.bgm_url && <option value="bgm">{t("项目音乐", "Project music")}</option>) :
                            (project.frames as any[]).filter(f => lane.kind === "dialogue" ? f.audio_url : f.sfx_url).map(f => <option key={f.id} value={f.id}>{f.dialogue || f.id}</option>)}
                    </select></label>}
                {lane.kind === "subtitle" && <><button type="button" className={control} onClick={() => {
                    const start = Math.min(position, plan.target_duration_ms - 1), end = Math.min(start + 2000, plan.target_duration_ms);
                    if (lane.clips.some(c => c.timeline_start_ms < end && start < c.timeline_end_ms)) { setError(t("此位置已有字幕，请移动播放头。", "A caption overlaps this position. Move the playhead.")); return; }
                    setError(null); onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: [...l.clips, { id: crypto.randomUUID(), timeline_start_ms: start, timeline_end_ms: end, source_start_ms: 0, text: t("新字幕", "New caption"), enabled: true, source_refs: [] }] } : l) });
                }}>{t("添加字幕", "Add caption")}</button><button type="button" className={control} disabled={!saved || busy || lane.muted} onClick={() => download(lane.id)}>{t("下载 SRT", "Download SRT")}</button></>}
            </div>
            <div className="relative h-10 overflow-hidden rounded bg-elevated" aria-label={`${lane.kind} timeline`}>
                {lane.clips.map(c => <button key={c.id} type="button" title={c.text || c.label || c.id} onClick={() => setPosition(c.timeline_start_ms)} className="absolute inset-y-1 min-w-1 truncate rounded bg-primary/40 px-1 text-left text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" style={{ left: `${c.timeline_start_ms / plan.target_duration_ms * 100}%`, width: `${(c.timeline_end_ms - c.timeline_start_ms) / plan.target_duration_ms * 100}%`, opacity: c.enabled && !lane.muted ? 1 : 0.3 }}>{c.text || c.label || c.id}</button>)}
                <span className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: `${position / plan.target_duration_ms * 100}%` }} />
            </div>
            {lane.kind !== "subtitle" && lane.clips.map(cue => <label key={cue.id} className="flex min-h-11 items-center gap-2 text-xs text-text-secondary">{cue.label || cue.id} · {t("音量", "Gain")}
                <input type="number" className={`${control} w-24`} min={0} max={2} step={0.1} value={cue.gain ?? 1} onChange={e => onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: l.clips.map(c => c.id === cue.id ? { ...c, gain: Math.max(0, Math.min(2, Number(e.target.value))) } : c) } : l) })} />
                {lane.kind !== "video" && <button type="button" className={control} onClick={() => onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: l.clips.filter(c => c.id !== cue.id) } : l) })}>{t("删除片段", "Delete clip")}</button>}
            </label>)}
            {lane.kind === "subtitle" && lane.clips.map(cue => <div key={cue.id} className="flex flex-wrap gap-2"><label className="flex-1 text-xs text-text-secondary">{t("字幕文本", "Caption text")}<textarea className={`${control} block w-full`} maxLength={2000} value={cue.text || ""} onChange={e => onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: l.clips.map(c => c.id === cue.id ? { ...c, text: e.target.value } : c) } : l) })} /></label><button type="button" className={control} onClick={() => onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: l.clips.filter(c => c.id !== cue.id) } : l) })}>{t("删除字幕", "Delete caption")}</button></div>)}
        </div>)}
    </section>;
}
