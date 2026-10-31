"use client";
import { useState, useRef, useEffect, type PointerEvent, type KeyboardEvent, type ReactNode } from "react";
import { createRenderRequestId } from '@/lib/renderRequestId';
import { useLocale } from "next-intl";
import { api, type AssemblyEditPlan } from "@/lib/api";
import type { Project } from "@/store/projectStore";
import { insertAssemblyVideo, reorderAssemblyVideo, snapAssemblyTimelineTime, moveAssemblyClipInTimeline, removeAssemblyClip, resizeAssemblyClipInTimeline, splitAssemblyClip, trimAssemblyClip } from "./assemblyEditing";
import { extractErrorDetail, getAssetUrl, getVideoPosterUrl } from "@/lib/utils";
import TimelineFilmstrip from './TimelineFilmstrip';
import TimelineAudioPreview, { usePreviewGain } from './TimelineAudioPreview';
import TimelineWaveform from './TimelineWaveform';
import { ChevronLeft, ChevronRight, Undo2, Redo2 } from 'lucide-react';

export function AssemblyTracks({ plan: committedPlan, resourceId, onChange, saved, project, materials, onUploadAudio, onExportSubtitles, materialPanel, audioLane, onAudioLaneChange, canUndo, canRedo, onUndo, onRedo }: {
    plan: AssemblyEditPlan; resourceId: string; saved: boolean; project: Pick<Project, "id" | "frames" | "video_tasks" | "bgm_url">;
    materialPanel?: ReactNode;
    materials?: Record<string, { url: string }>;
    onUploadAudio?: (file: File) => Promise<{ media_id: string; url: string; duration_ms: number }>;
    onExportSubtitles?: (lane: string) => Promise<Blob>;
    audioLane?: 'bgm' | 'dialogue' | 'sfx';
    onAudioLaneChange?: (lane: 'bgm' | 'dialogue' | 'sfx') => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
    onChange: (plan: AssemblyEditPlan) => void;
}) {
    const [dragPreview, setDragPreview] = useState<AssemblyEditPlan | null>(null);
    const plan = dragPreview || committedPlan;
    const zh = useLocale().startsWith("zh");
    const t = (cn: string, en: string) => zh ? cn : en;
    const videoDrag = useRef<string | null>(null);
    const [snapTime, setSnapTime] = useState<number | null>(null);
    const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
    const [position, setPosition] = useState(0);
    const [showMaterials, setShowMaterials] = useState(false);
    const [showInspector, setShowInspector] = useState(true);
    const [trackHeight, setTrackHeight] = useState(300);
    const [zoom, setZoom] = useState(1);
    const [viewportWidth, setViewportWidth] = useState(640);
    const timelineViewport = useRef<HTMLDivElement>(null);
    const timelineWidth = Math.max(640, viewportWidth) * zoom;
    const tickSeconds = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find(step => step * 1000 / plan.target_duration_ms * timelineWidth >= 70) || Math.ceil(plan.target_duration_ms / 1000 / 10);
    const ticks = Array.from({ length: Math.floor(plan.target_duration_ms / (tickSeconds * 1000)) + 1 }, (_, i) => i * tickSeconds);
    useEffect(() => {
        const element = timelineViewport.current;
        if (!element) return;
        const measure = () => setViewportWidth(element.clientWidth || 640);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<{ laneId: string; clipId: string } | null>(null);
    const [sourceIn, setSourceIn] = useState(0);
    const [sourceOut, setSourceOut] = useState(1);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [buffering, setBuffering] = useState(false);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [uploadedAudioSources, setUploadedAudioSources] = useState<Record<string, string>>({});
    const dragRef = useRef<{ laneId: string; clipId: string; startX: number; origin: number; base?: AssemblyEditPlan; next?: AssemblyEditPlan; mode: "move" | "resize"; edge?: "start" | "end" } | null>(null);
    const laneName = (kind: string) => ({ video: t("视频", "Video"), subtitle: t("字幕", "Subtitles"), dialogue: t("对白", "Dialogue"), bgm: t("音乐", "Music"), sfx: t("音效", "SFX"), markers: t("标记", "Markers") }[kind] || kind);
    const videos = plan.lanes.filter(l => l.kind === "video" && !l.muted).flatMap(l => l.clips.filter(c => c.enabled)).sort((a,b) => a.timeline_start_ms - b.timeline_start_ms);
    const sequence = plan.lanes.filter(l => l.kind === "video").flatMap(l => l.clips.map(clip => ({ laneId: l.id, clip }))).sort((a,b) => a.clip.timeline_start_ms - b.clip.timeline_start_ms);
    const currentVideo = videos.find(c => c.timeline_start_ms <= position && position < c.timeline_end_ms);
    const mediaFor = (clip: typeof videos[number]) => {
        if (materials && clip.source_media_id) {
            const url = materials[clip.source_media_id]?.url;
            return url ? { url: getAssetUrl(url), poster: getVideoPosterUrl(url) } : null;
        }
        if (clip.source_project_id && clip.source_project_id !== project.id) return null;
        const frame = project.frames.find(f => f.id === clip.source_frame_id);
        const task = project.video_tasks?.find(task => task.id === clip.source_task_id);
        const url = clip.source_task_id ? task?.video_url : frame?.video_url;
        const still = frame?.rendered_image_url || frame?.image_url;
        return url ? { url: getAssetUrl(url), poster: getVideoPosterUrl(url) || getAssetUrl(still) } : null;
    };
    const currentMedia = currentVideo ? mediaFor(currentVideo) : null;
    const sourceTime = currentVideo ? ((currentVideo.source_start_ms ?? 0) + (position - currentVideo.timeline_start_ms) * ((currentVideo.source_end_ms ?? (currentVideo.source_start_ms ?? 0) + currentVideo.timeline_end_ms - currentVideo.timeline_start_ms) - (currentVideo.source_start_ms ?? 0)) / (currentVideo.timeline_end_ms - currentVideo.timeline_start_ms)) / 1000 : 0;
    const syncVideo = () => {
        const video = videoRef.current;
        if (!video || !currentVideo) return;
        const sourceDuration = (currentVideo.source_end_ms ?? (currentVideo.source_start_ms ?? 0) + currentVideo.timeline_end_ms - currentVideo.timeline_start_ms) - (currentVideo.source_start_ms ?? 0);
        video.playbackRate = Math.max(0.0625, Math.min(16, sourceDuration / (currentVideo.timeline_end_ms - currentVideo.timeline_start_ms)));
        if (Math.abs(video.currentTime - sourceTime) > 0.12) video.currentTime = sourceTime;
        if (playing) void video.play().catch(() => { setPlaying(false); setMediaError(t("视频播放失败，请重新播放或检查素材。", "Video playback failed. Retry or check the source.")); });
        else video.pause();
    };
    useEffect(() => { syncVideo(); }, [position, currentVideo?.id, currentMedia?.url, currentVideo?.source_start_ms, currentVideo?.source_end_ms, currentVideo?.timeline_start_ms, currentVideo?.timeline_end_ms, playing]);
    useEffect(() => { if (!currentMedia) setPlaying(false); }, [currentMedia?.url]);
    useEffect(() => { setPlaying(false); setPosition(0); setSelected(null); setMediaError(null); }, [project.id]);
    useEffect(() => { setMediaError(null); }, [currentMedia?.url]);
    const seek = (value: number) => { setMediaError(null); setPosition(Math.max(0, Math.min(plan.target_duration_ms, Math.round(value)))); };
    useEffect(() => { setPosition(value => Math.min(value, plan.target_duration_ms)); }, [plan.target_duration_ms]);
    const selectClip = (laneId: string, clip: typeof videos[number]) => {
        setSelected({ laneId, clipId: clip.id });
        setSourceIn(clip.source_start_ms ?? 0);
        setSourceOut(clip.source_end_ms ?? (clip.source_start_ms ?? 0) + clip.timeline_end_ms - clip.timeline_start_ms);
        seek(clip.timeline_start_ms);
    };
    const beginDrag = (event: PointerEvent, laneId: string, clipId: string, origin: number) => {
        const lane = plan.lanes.find(item => item.id === laneId);
        if (!lane || lane.kind === "video") return;
        dragRef.current = { laneId, clipId, startX: event.clientX, origin, base: committedPlan, mode: "move" };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const updateDrag = (event: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const timeline = event.currentTarget.closest("[data-timeline-width]") as HTMLElement | null;
        const width = timeline?.clientWidth || 0;
        if (!width) return;
        const base = drag.base || committedPlan;
        drag.base = base;
        const delta = Math.round((event.clientX - drag.startX) / width * base.target_duration_ms / 10) * 10;
        const raw = drag.origin + delta;
        const snapped = snapAssemblyTimelineTime(base, drag.laneId, drag.clipId, raw);
        setSnapTime(snapped !== raw ? snapped : null);
        try {
            const next = drag.mode === "move"
                ? moveAssemblyClipInTimeline(base, drag.laneId, drag.clipId, snapped)
                : resizeAssemblyClipInTimeline(base, drag.laneId, drag.clipId, drag.edge!, snapped);
            drag.next = next;
            setDragPreview(next);
            setError(null);
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    };
    const endDrag = (cancel = false) => {
        const drag = dragRef.current;
        dragRef.current = null; setSnapTime(null); setDragPreview(null);
        if (!cancel && drag?.next && drag.base === committedPlan && JSON.stringify(drag.next) !== JSON.stringify(committedPlan)) onChange(drag.next);
    };
    const selectedLane = plan.lanes.find(l => l.id === selected?.laneId);
    const selectedClip = selectedLane?.clips.find(c => c.id === selected?.clipId);
    useEffect(() => {
        if (!selectedClip) return;
        setSourceIn(selectedClip.source_start_ms ?? 0);
        setSourceOut(selectedClip.source_end_ms ?? (selectedClip.source_start_ms ?? 0) + selectedClip.timeline_end_ms - selectedClip.timeline_start_ms);
    }, [selectedClip?.id, selectedClip?.source_start_ms, selectedClip?.source_end_ms, selectedClip?.timeline_start_ms, selectedClip?.timeline_end_ms]);
    // Video splitting follows the visible playhead; explicitly selected audio
    // and subtitle lanes retain their own target rather than splitting video.
    const splitClip = selectedLane && selectedLane.kind !== 'video' ? selectedClip : currentVideo;
    const splitLane = selectedLane && selectedLane.kind !== 'video' ? selectedLane : plan.lanes.find(l => l.kind === 'video' && l.clips.some(c => c.id === splitClip?.id));
    const canSplit = Boolean(splitClip && splitLane && position > splitClip.timeline_start_ms && position < splitClip.timeline_end_ms);
    const audioUrlFor = (clip: typeof videos[number], kind: string) => {
        if (materials) return getAssetUrl(materials[clip.source_media_id || ""]?.url);
        if (clip.source_project_id && clip.source_project_id !== project.id) return "";
        return uploadedAudioSources[clip.source_media_id || ""] || getAssetUrl(kind === "bgm" ? project.bgm_url : project.frames.find(f => f.id === clip.source_frame_id)?.[kind === "dialogue" ? "audio_url" : "sfx_url"]);
    };
    const audioClips = plan.lanes.filter(l => ["dialogue", "bgm", "sfx"].includes(l.kind) && !l.muted).flatMap(lane => lane.clips.filter(c => c.enabled).map(clip => ({ lane, clip, url: audioUrlFor(clip, lane.kind) })));
    const [audioError, setAudioError] = useState(false);
    const reportAudioError = () => setAudioError(true);
    useEffect(() => { setAudioError(false); }, [playing, project.id]);
    usePreviewGain(videoRef, currentVideo?.gain ?? 1, playing, currentMedia?.url || "", reportAudioError);
    const selectedAudioUrl = selectedLane && selectedClip && ["dialogue", "bgm", "sfx"].includes(selectedLane.kind) ? audioUrlFor(selectedClip, selectedLane.kind) : "";
    const uploadAudio = async (laneId: string, kind: "dialogue" | "bgm" | "sfx", file: File) => {
        setBusy(true); setError(null);
        try {
            const uploaded: { url?: string; media_id?: string; duration_ms?: number } = onUploadAudio ? await onUploadAudio(file) : await api.uploadFile(file);
            if (!uploaded.media_id) throw new Error(t("上传未返回素材 ID", "Upload did not return a media ID"));
            setUploadedAudioSources(current => ({ ...current, [uploaded.media_id!]: uploaded.url || "" }));
            const start = Math.min(position, plan.target_duration_ms - 1);
            onChange({ ...plan, lanes: plan.lanes.map(l => l.id === laneId ? { ...l, clips: [...l.clips, {
                id: createRenderRequestId(), timeline_start_ms: start, timeline_end_ms: Math.min(start + (uploaded.duration_ms || 2000), plan.target_duration_ms),
                source_start_ms: 0, source_project_id: onUploadAudio ? undefined : project.id, source_media_id: uploaded.media_id,
                source_refs: [`media:${uploaded.media_id}`], label: file.name, enabled: true, gain: 1,
            }] } : l) });
        } catch (e) { setError(extractErrorDetail(e)); } finally { setBusy(false); }
    };
    const applyEdit = (edit: () => AssemblyEditPlan) => {
        try { onChange(edit()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    };
    const onWorkbenchKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        const target = event.target as HTMLElement;
        // Preserve native input, media and interactive-control keyboard behavior.
        // closest also catches descendants of rich-text editors and buttons.
        if (target.closest('input, textarea, select, button, a, audio, video, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
        if (event.key === " ") { event.preventDefault(); if (!event.repeat && currentMedia) setPlaying(value => !value); return; }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); seek(position + (event.key === "ArrowRight" ? 100 : -100)); return; }
        if (event.repeat) return;
        if (event.key.toLowerCase() === "s" && canSplit) { event.preventDefault(); if (splitClip && splitLane) applyEdit(() => splitAssemblyClip(plan, splitLane.id, splitClip.id, position, createRenderRequestId())); return; }
        if ((event.key === "Delete" || event.key === "Backspace") && selected) { event.preventDefault(); applyEdit(() => removeAssemblyClip(plan, selected.laneId, selected.clipId)); setSelected(null); }
    };
    const control = "min-h-11 rounded-md border border-glass-border bg-elevated px-3 py-2 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40";
    const active = plan.lanes.filter(l => l.kind === "subtitle" && !l.muted).flatMap(l => l.clips.filter(c => c.enabled && c.timeline_start_ms <= position && position < c.timeline_end_ms));
    const download = async (id: string) => {
        setBusy(true); setError(null);
        try {
            const blob = onExportSubtitles ? await onExportSubtitles(id) : await api.exportAssemblySubtitles(plan.scope, resourceId, id);
            const url = URL.createObjectURL(blob); const a = document.createElement("a");
            a.href = url; a.download = "subtitles.srt"; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) { setError(extractErrorDetail(e)); } finally { setBusy(false); }
    };
    return <section tabIndex={0} onKeyDown={onWorkbenchKeyDown} aria-label={t("多泳道编辑", "Multitrack editing")} className="min-w-0 space-y-3 rounded-lg border border-glass-border p-3" style={{ contain: "inline-size" }}>
        <div data-editing-workspace className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
            {materialPanel && <button type="button" className={`${control} px-2`} aria-label={t("切换素材面板", "Toggle material panel")} title={t("素材面板", "Material panel")} aria-expanded={showMaterials} onClick={() => setShowMaterials(value => !value)}>{showMaterials ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>}
            <button type="button" className={`${control} px-2`} aria-label={t("切换片段属性", "Toggle clip properties")} title={t("片段属性", "Clip properties")} aria-expanded={showInspector} onClick={() => setShowInspector(value => !value)}>{showInspector ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-stretch">
        {materialPanel && showMaterials && <aside aria-label={t("素材选择面板", "Material picker panel")} className="min-w-0 overflow-auto rounded-lg border border-glass-border p-2 lg:max-h-[45dvh] lg:w-72 lg:shrink-0">{materialPanel}</aside>}
        <div data-editing-preview className="min-w-0 flex-1 space-y-2 rounded-lg bg-surface p-2">
        <div className="relative mx-auto aspect-video max-h-[24dvh] lg:max-h-[45dvh] w-full overflow-hidden rounded-lg bg-black">
            {currentMedia ? <video ref={videoRef} key={currentMedia.url} src={currentMedia.url} poster={currentMedia.poster || undefined} preload="metadata" playsInline className="h-full w-full object-contain" aria-label={t("剪辑画面预览", "Timeline video preview")}
                onLoadedMetadata={syncVideo} onWaiting={() => setBuffering(true)} onPlaying={() => setBuffering(false)} onError={() => { setPlaying(false); setMediaError(t("视频无法加载，请检查该镜头素材。", "Video unavailable. Check this shot's media.")); }}
                onTimeUpdate={e => {
                    if (!playing || !currentVideo) return;
                    const sourceStart = currentVideo.source_start_ms ?? 0;
                    const sourceEnd = currentVideo.source_end_ms ?? sourceStart + currentVideo.timeline_end_ms - currentVideo.timeline_start_ms;
                    const time = currentVideo.timeline_start_ms + (e.currentTarget.currentTime * 1000 - sourceStart) / (sourceEnd - sourceStart) * (currentVideo.timeline_end_ms - currentVideo.timeline_start_ms);
                    if (time >= currentVideo.timeline_end_ms - 30) {
                        if (currentVideo.timeline_end_ms >= plan.target_duration_ms) { setPlaying(false); setPosition(plan.target_duration_ms); }
                        else setPosition(currentVideo.timeline_end_ms);
                    } else setPosition(Math.max(currentVideo.timeline_start_ms, time));
                }} onEnded={() => { if (currentVideo && currentVideo.timeline_end_ms < plan.target_duration_ms) setPosition(currentVideo.timeline_end_ms); else setPlaying(false); }} /> : <div className="flex h-full items-center justify-center text-sm text-white">{t("此位置没有可用视频，请选择时间线中的镜头。", "No video at this position. Select a shot on the timeline.")}</div>}
            {active.length > 0 && <div className="pointer-events-none absolute inset-x-4 bottom-6 whitespace-pre-wrap text-center text-lg text-white [text-shadow:0_1px_3px_black]">{active.map(c => c.text).join("\n")}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={control} disabled={!currentMedia} onClick={() => setPlaying(value => !value)}>{playing ? t("暂停", "Pause") : t("播放", "Play")}</button>
            <span className="text-xs text-text-secondary">{currentVideo?.label || t("选择镜头预览", "Select a shot to preview")}</span>
            <span className="text-xs text-text-muted">{t("音轨随播放头同步预览；最终混音和字幕样式以导出成片为准。", "Audio tracks follow the playhead. Export to review final mixing and caption styling.")}</span>
        </div>
        {audioClips.filter(item => item.url).map(({ lane, clip, url }) => <TimelineAudioPreview key={project.id + lane.id + clip.id + url} url={url} position={position} start={clip.timeline_start_ms} end={clip.timeline_end_ms} sourceStart={clip.source_start_ms ?? 0} sourceEnd={clip.source_end_ms ?? (clip.source_start_ms ?? 0) + clip.timeline_end_ms - clip.timeline_start_ms} gain={clip.gain ?? 1} playing={playing && !buffering} label={laneName(lane.kind) + " · " + (clip.label || clip.id)} onError={reportAudioError} />)}
        {(audioError || audioClips.some(item => !item.url)) && <p role="alert" className="text-xs text-red-300">{t("部分音频无法预览，请检查素材或重新播放。", "Some audio could not be previewed. Check the source or retry playback.")}</p>}
        {mediaError && <p role="alert" className="text-xs text-red-300">{mediaError}</p>}
        </div>
        {showInspector && <aside aria-label={t("选中片段属性", "Selected clip properties")} className="min-w-0 overflow-y-auto rounded-lg border border-glass-border p-2 lg:max-h-[45dvh] lg:w-72 lg:shrink-0">
            <h3 className="mb-2 text-sm font-medium">{t("片段属性", "Clip properties")}</h3>
            {!selectedClip && <p className="text-xs text-text-secondary">{t("点击时间轴片段，编辑裁剪、顺序、音量和字幕。", "Select a timeline clip to edit trim, order, gain and captions.")}</p>}
        {selected && selectedClip && <div className="flex flex-wrap items-end gap-2 rounded border border-glass-border p-2">
            <span className="text-xs text-text-secondary">{selectedClip.label || selectedClip.id}</span>
            {selectedAudioUrl && <label className="w-full text-xs text-text-secondary">{t("试听素材", "Preview source")}
                <audio controls preload="metadata" src={selectedAudioUrl} aria-label={t("选中音频试听", "Selected audio preview")} className="mt-1 h-9 w-full" />
            </label>}
            {selectedLane?.kind !== "subtitle" && <>
                <label className="text-xs text-text-secondary">{t("源入点（毫秒）", "Source in (ms)")}<input className={`${control} block w-32`} type="number" min={0} step={1} value={sourceIn} onChange={e => setSourceIn(Number(e.target.value))} /></label>
                <label className="text-xs text-text-secondary">{t("源出点（毫秒）", "Source out (ms)")}<input className={`${control} block w-32`} type="number" min={1} step={1} value={sourceOut} onChange={e => setSourceOut(Number(e.target.value))} /></label>
                <button type="button" className={control} onClick={() => applyEdit(() => trimAssemblyClip(plan, selected.laneId, selected.clipId, sourceIn, sourceOut))}>{t("应用原速裁切", "Apply trim at original speed")}</button>
            </>}
            {selectedLane?.kind === "video" && <>
                <button type="button" className={control} disabled={sequence[0]?.clip.id === selectedClip.id} onClick={() => applyEdit(() => reorderAssemblyVideo(plan, selectedClip.id, -1))}>{t("向前移动", "Move earlier")}</button>
                <button type="button" className={control} disabled={sequence[sequence.length - 1]?.clip.id === selectedClip.id} onClick={() => applyEdit(() => reorderAssemblyVideo(plan, selectedClip.id, 1))}>{t("向后移动", "Move later")}</button>
            </>}
            <button type="button" className={`${control} border-red-500/40 text-red-200`} onClick={() => applyEdit(() => removeAssemblyClip(plan, selected.laneId, selected.clipId))}>{t("删除片段", "Delete clip")}</button>
        </div>}
        {selectedLane && <div>{[selectedLane].map(lane => <div key={lane.id}>            {lane.kind !== "subtitle" && lane.clips.filter(c => selected?.laneId === lane.id && selected?.clipId === c.id).map(cue => <label key={cue.id} className="flex min-h-11 items-center gap-2 text-xs text-text-secondary">{cue.label || cue.id} · {t("音量", "Gain")}
                <input type="number" className={`${control} w-24`} min={0} max={2} step={0.1} value={cue.gain ?? 1} onChange={e => onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: l.clips.map(c => c.id === cue.id ? { ...c, gain: Math.max(0, Math.min(2, Number(e.target.value))) } : c) } : l) })} />

            </label>)}
            {lane.kind === "subtitle" && lane.clips.filter(cue => selected?.laneId === lane.id && selected?.clipId === cue.id).map(cue => <div key={cue.id} className="flex flex-wrap gap-2"><label className="flex-1 text-xs text-text-secondary">{t("字幕文本", "Caption text")}<textarea className={`${control} block w-full`} maxLength={2000} value={cue.text || ""} onChange={e => onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: l.clips.map(c => c.id === cue.id ? { ...c, text: e.target.value } : c) } : l) })} /></label><button type="button" className={control} onClick={() => onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: l.clips.filter(c => c.id !== cue.id) } : l) })}>{t("删除字幕", "Delete caption")}</button></div>)}
</div>)}</div>}

        </aside>}
        </div>
        <div data-editing-timeline className="min-w-0 space-y-2 rounded-lg border border-glass-border p-2">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-glass-border bg-surface p-2" role="toolbar" aria-label={t("时间轴工具", "Timeline tools")}><span className="text-sm font-medium">{t("时间轴", "Timeline")}</span>
            {onUndo && <button type="button" className={`${control} px-2`} aria-label={t("撤销", "Undo")} title={t("撤销", "Undo")} disabled={!canUndo} onClick={onUndo}><Undo2 size={15} /></button>}
            {onRedo && <button type="button" className={`${control} px-2`} aria-label={t("重做", "Redo")} title={t("重做", "Redo")} disabled={!canRedo} onClick={onRedo}><Redo2 size={15} /></button>}
            {onAudioLaneChange && <label className="flex items-center gap-1 text-xs text-text-secondary"><span>{t("添加音频", "Add audio")}</span><select className={control} value={audioLane} onChange={e => onAudioLaneChange(e.target.value as 'bgm' | 'dialogue' | 'sfx')}><option value="bgm">BGM</option><option value="dialogue">{t("对白", "Dialogue")}</option><option value="sfx">{t("音效", "SFX")}</option></select></label>}
            <button type="button" className={control} aria-label={t("缩小时间轴", "Zoom out")} disabled={zoom <= 0.5} onClick={() => setZoom(z => Math.max(0.5, z / 2))}>{t("缩小时间轴 −", "Zoom out −")}</button>
            <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" className={control} aria-label={t("放大时间轴", "Zoom in")} disabled={zoom >= 16} onClick={() => setZoom(z => Math.min(16, z * 2))}>{t("放大时间轴 ＋", "Zoom in ＋")}</button>
            <button type="button" className={control} onClick={() => { setZoom(1); if (timelineViewport.current) timelineViewport.current.scrollLeft = 0; }}>{t("适应时间轴", "Fit timeline")}</button>
        </div>
        <div className="flex flex-wrap gap-2">{(["subtitle", "dialogue", "bgm", "sfx"] as const).map(kind => <button key={kind} className={control} type="button" disabled={plan.lanes.length >= 8} onClick={() => onChange({ ...plan, lanes: [...plan.lanes, { id: `${kind}-${createRenderRequestId()}`, kind, label: kind, clips: [], allow_overlap: kind !== "subtitle" }] })}>{t("添加", "Add")} {laneName(kind)}</button>)}</div>
        <label className="block text-xs text-text-secondary">{t("时间线播放头", "Timeline playhead")} · {(position / 1000).toFixed(2)}s<input className="block w-full accent-primary" type="range" aria-label={t("时间线播放头", "Timeline playhead")} min={0} max={plan.target_duration_ms} step={10} value={position} onChange={e => seek(Number(e.target.value))} /></label>
        <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs">{t("播放头（秒）", "Playhead (seconds)")} <input className={`${control} w-28`} type="number" min={0} max={plan.target_duration_ms / 1000} step={0.001} value={position / 1000} onChange={e => seek(Number(e.target.value) * 1000)} /></label>
            <button type="button" className={`${control} border-primary text-primary`} disabled={!canSplit} onClick={() => {
                if (splitClip && splitLane) applyEdit(() => splitAssemblyClip(plan, splitLane.id, splitClip.id, position, createRenderRequestId()));
            }}>{t("在播放头分割", "Split at playhead")}</button>
            <span className="text-xs text-text-secondary" role="status">{splitClip ? t(`分割对象：${splitClip.label || splitClip.id} · ${(position / 1000).toFixed(3)} 秒`, `Split target: ${splitClip.label || splitClip.id} · ${(position / 1000).toFixed(3)}s`) : t("将播放头移到要分割的片段内部。", "Move the playhead inside the clip to split it.")}{splitClip && !canSplit ? t(" · 请将播放头移到片段内部。", " · Move the playhead inside the clip.") : ''}</span>

        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">{t("轨道区域高度", "Track area height")}<input type="range" min={180} max={600} step={20} value={trackHeight} onChange={event => setTrackHeight(Number(event.target.value))} /><span>{trackHeight}px</span></label>
        <div ref={timelineViewport} className="w-full min-w-0 overflow-auto" style={{ contain: "inline-size", height: trackHeight }} aria-label={t("可横向滚动的时间线", "Scrollable timeline")}><div data-timeline-canvas style={{ width: timelineWidth }}>
        <div role="slider" tabIndex={0} aria-label={t("时间轴刻度", "Timeline ruler")} aria-valuemin={0} aria-valuemax={plan.target_duration_ms / 1000} aria-valuenow={position / 1000} className="relative h-10 cursor-crosshair border-b border-glass-border bg-elevated text-xs tabular-nums" onPointerDown={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            seek((event.clientX - bounds.left) / bounds.width * plan.target_duration_ms);
        }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seek(position + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1000 : 10)); } }}>
            {ticks.map(seconds => <span key={seconds} className="pointer-events-none absolute inset-y-0 border-l border-glass-border pl-1 pt-1" style={{ left: `${seconds * 1000 / plan.target_duration_ms * 100}%` }}>{seconds.toFixed(tickSeconds < 1 ? 1 : 0)}s</span>)}
            <span className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary" style={{ left: `${position / plan.target_duration_ms * 100}%` }} />
            {snapTime !== null && <span role="status" aria-label={t("吸附位置", "Snap position")} className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-amber-300" style={{ left: `${snapTime / plan.target_duration_ms * 100}%` }} />}
        </div>
        {plan.lanes.map(lane => <div key={lane.id} className="space-y-2 border-t border-glass-border pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary"><span>{laneName(lane.kind)}</span>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={Boolean(lane.muted)} onChange={e => onChange({ ...plan, burn_subtitle_lane_id: e.target.checked && plan.burn_subtitle_lane_id === lane.id ? null : plan.burn_subtitle_lane_id, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, muted: e.target.checked } : l) })} />{t("静音 / 隐藏", "Mute / hide")}</label>
                {lane.kind !== "video" && <button type="button" className={control} onClick={() => onChange({ ...plan, burn_subtitle_lane_id: plan.burn_subtitle_lane_id === lane.id ? null : plan.burn_subtitle_lane_id, lanes: plan.lanes.filter(l => l.id !== lane.id) })}>{t("移除泳道", "Remove lane")}</button>}
                {!materials && (["dialogue", "bgm", "sfx"] as string[]).includes(lane.kind) && <label>{t("添加项目音频", "Add project audio")}
                    <select className={control} value="" onChange={e => {
                        if (!e.target.value) return;
                        const sourceId = e.target.value;
                        const start = Math.min(position, plan.target_duration_ms - 1);
                        onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: [...l.clips, {
                            id: createRenderRequestId(), timeline_start_ms: start, timeline_end_ms: Math.min(start + 2000, plan.target_duration_ms),
                            source_start_ms: 0, source_project_id: project.id,
                            source_frame_id: lane.kind === "bgm" ? undefined : sourceId,
                            source_refs: [`project:${project.id}:${sourceId}`], label: sourceId, enabled: true, gain: 1,
                        }] } : l) });
                    }}><option value="">{t("选择来源", "Select source")}</option>
                        {lane.kind === "bgm" ? (project.bgm_url && <option value="bgm">{t("项目音乐", "Project music")}</option>) :
                            (project.frames as any[]).filter(f => lane.kind === "dialogue" ? f.audio_url : f.sfx_url).map(f => <option key={f.id} value={f.id}>{f.dialogue || f.id}</option>)}
                    </select></label>}
                {(["dialogue", "bgm", "sfx"] as string[]).includes(lane.kind) && <label className={`${control} cursor-pointer`}>{t("上传音频", "Upload audio")}
                    <input type="file" accept="audio/*" className="sr-only" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void uploadAudio(lane.id, lane.kind as "dialogue" | "bgm" | "sfx", file); e.currentTarget.value = ""; }} />
                </label>}
                {lane.kind === "subtitle" && <><button type="button" className={control} onClick={() => {
                    const start = Math.min(position, plan.target_duration_ms - 1), end = Math.min(start + 2000, plan.target_duration_ms);
                    if (lane.clips.some(c => c.timeline_start_ms < end && start < c.timeline_end_ms)) { setError(t("此位置已有字幕，请移动播放头。", "A caption overlaps this position. Move the playhead.")); return; }
                    setError(null); onChange({ ...plan, lanes: plan.lanes.map(l => l.id === lane.id ? { ...l, clips: [...l.clips, { id: createRenderRequestId(), timeline_start_ms: start, timeline_end_ms: end, source_start_ms: 0, text: t("新字幕", "New caption"), enabled: true, source_refs: [] }] } : l) });
                }}>{t("添加字幕", "Add caption")}</button><button type="button" className={control} disabled={!saved || busy || lane.muted} onClick={() => download(lane.id)}>{t("下载 SRT", "Download SRT")}</button></>}
            </div>
            <div className={`relative overflow-hidden rounded bg-elevated ${lane.kind === "video" ? "h-24" : "h-10"}`} data-timeline-width aria-label={`${lane.kind} timeline`} onPointerMove={updateDrag} onPointerUp={() => endDrag()} onPointerCancel={() => endDrag(true)} onLostPointerCapture={() => endDrag(true)}>
                {lane.clips.map(c => <button key={c.id} type="button"
                    draggable={lane.kind === "video"}
                    onDragStart={event => {
                        if (lane.kind !== "video") return;
                        videoDrag.current = c.id; event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", c.id);
                    }}
                    onDragOver={event => {
                        if (lane.kind !== "video" || !videoDrag.current || videoDrag.current === c.id) return;
                        event.preventDefault(); event.dataTransfer.dropEffect = "move";
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setDropTarget({ id: c.id, after: event.clientX >= bounds.left + bounds.width / 2 });
                    }}
                    onDrop={event => {
                        if (lane.kind !== "video" || !videoDrag.current || videoDrag.current === c.id) return;
                        event.preventDefault();
                        const bounds = event.currentTarget.getBoundingClientRect();
                        const next = insertAssemblyVideo(plan, videoDrag.current, c.id, event.clientX >= bounds.left + bounds.width / 2);
                        if (next !== plan) onChange(next);
                        videoDrag.current = null; setDropTarget(null);
                    }}
                    onDragEnd={() => { videoDrag.current = null; setDropTarget(null); }} aria-label={lane.kind === "video" ? `${t("编辑片段", "Edit clip")} ${sequence.findIndex(item => item.clip.id === c.id) + 1}: ${c.label || c.id}` : (c.text || c.label || c.id)} title={c.text || c.label || c.id} onPointerDown={e => { selectClip(lane.id, c); beginDrag(e, lane.id, c.id, c.timeline_start_ms); }} onClick={() => {
                    setSelected({ laneId: lane.id, clipId: c.id });
                    setSourceIn(c.source_start_ms ?? 0);
                    setSourceOut(c.source_end_ms ?? (c.source_start_ms ?? 0) + c.timeline_end_ms - c.timeline_start_ms);
                    seek(c.timeline_start_ms);
                }} aria-pressed={selected?.laneId === lane.id && selected?.clipId === c.id} className="absolute inset-y-1 min-w-1 truncate rounded bg-primary/40 px-1 text-left text-xs text-foreground aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" style={{ left: `${c.timeline_start_ms / plan.target_duration_ms * 100}%`, width: `${(c.timeline_end_ms - c.timeline_start_ms) / plan.target_duration_ms * 100}%`, opacity: c.enabled && !lane.muted ? 1 : 0.3 }}>{lane.kind === "video" && mediaFor(c) && <TimelineFilmstrip url={mediaFor(c)!.url} poster={mediaFor(c)!.poster} startMs={c.source_start_ms ?? 0} endMs={c.source_end_ms ?? (c.source_start_ms ?? 0) + c.timeline_end_ms - c.timeline_start_ms} width={timelineWidth * (c.timeline_end_ms - c.timeline_start_ms) / plan.target_duration_ms} />}{dropTarget?.id === c.id && <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 z-20 w-1 bg-primary ${dropTarget.after ? "right-0" : "left-0"}`} />}
                    {["dialogue", "bgm", "sfx"].includes(lane.kind) && audioUrlFor(c, lane.kind) && <TimelineWaveform url={audioUrlFor(c, lane.kind)} startMs={c.source_start_ms ?? 0} endMs={c.source_end_ms ?? (c.source_start_ms ?? 0) + c.timeline_end_ms - c.timeline_start_ms} />}
                    <span className="pointer-events-none block truncate">{c.text || c.label || c.id}</span>{selected?.laneId === lane.id && selected?.clipId === c.id && <><span role="button" aria-label={`${c.label || c.id} start handle`} className="absolute inset-y-0 left-0 z-10 w-3 cursor-ew-resize bg-foreground/30" onPointerDown={e => { e.stopPropagation(); dragRef.current = { laneId: lane.id, clipId: c.id, startX: e.clientX, origin: c.timeline_start_ms, base: committedPlan, mode: "resize", edge: "start" }; e.currentTarget.setPointerCapture(e.pointerId); }} /><span role="button" aria-label={`${c.label || c.id} end handle`} className="absolute inset-y-0 right-0 z-10 w-3 cursor-ew-resize bg-foreground/30" onPointerDown={e => { e.stopPropagation(); dragRef.current = { laneId: lane.id, clipId: c.id, startX: e.clientX, origin: c.timeline_end_ms, base: committedPlan, mode: "resize", edge: "end" }; e.currentTarget.setPointerCapture(e.pointerId); }} /></>}</button>)}
                <span className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: `${position / plan.target_duration_ms * 100}%` }} />
            </div>
        </div>)}
        </div></div>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <details className="mt-2 rounded border border-glass-border p-2"><summary className="min-h-11 cursor-pointer py-3 text-xs">{t("成片字幕与导出设置", "Caption and export settings")}</summary>
        <label className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">{t("成片字幕", "Video captions")}
            <select className={control} value={plan.burn_subtitle_lane_id || ""} onChange={e => onChange({ ...plan, burn_subtitle_lane_id: e.target.value || null })}>
                <option value="">{t("不烧录（仅 SRT）", "No burn-in (SRT only)")}</option>
                {plan.lanes.filter(l => l.kind === "subtitle" && !l.muted).map(l => <option key={l.id} value={l.id}>{t("烧录", "Burn in")} · {l.label || l.id}</option>)}
            </select>
        </label>
        <p className="text-xs text-text-muted">{t("修改后先保存再导出。烧录字幕会永久进入画面；其他字幕轨仍可单独下载 SRT。", "Save changes before export. Burned captions become part of the picture; other tracks remain available as SRT.")}</p>
        </details>
        </div></div>
    </section>;
}
