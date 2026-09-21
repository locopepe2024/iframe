"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, Film, AlertTriangle, Layout, Clock, FileText, Download, Music, Sliders, Package, ArrowDown, ArrowUp, Save, Plus } from "lucide-react";
import { useProjectStore, type Project } from "@/store/projectStore";
import { api, type AssemblyClip, type AssemblyEditPlan, type BgmPreset } from "@/lib/api";
import { getAssetUrl, extractErrorDetail } from "@/lib/utils";
import StepPageHeader, { StepPill } from "@/components/shared/StepPageHeader";
import SidePanelHeader from "@/components/shared/SidePanelHeader";
import { getAssemblyReadiness, resolveAssemblyVideo } from "./assemblyReadiness";
import { buildDraftAssemblyPlan, formatAssemblyTime, moveAssemblyClip, updateAssemblyClip } from "./assemblyEditPlan";

type AssemblyPhase = "timeline" | "takes" | "mix" | "export";

export default function VideoAssembly() {
    const ta = useTranslations("assembly");
    const tStep = useTranslations("stepHeader");
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);

    const [phase, setPhase] = useState<AssemblyPhase>("timeline");
    const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
    const [isMerging, setIsMerging] = useState(false);
    const [mergeError, setMergeError] = useState<string | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [assemblyPlan, setAssemblyPlan] = useState<AssemblyEditPlan | null>(
        currentProject?.assembly_plan ?? null,
    );
    const [isSavingPlan, setIsSavingPlan] = useState(false);
    const [planError, setPlanError] = useState<string | null>(null);

    useEffect(() => {
        setAssemblyPlan(currentProject?.assembly_plan ?? null);
        setPlanError(null);
    }, [currentProject?.id, currentProject?.assembly_plan]);

    // Group videos by frame
    const videosByFrame = useMemo(() => {
        if (!currentProject?.video_tasks) return {};

        const grouped: Record<string, any[]> = {};
        currentProject.video_tasks.forEach((task: any) => {
            if (task.status === "completed" && task.video_url) {
                if (task.frame_id) {
                    if (!grouped[task.frame_id]) grouped[task.frame_id] = [];
                    grouped[task.frame_id].push(task);
                }
            }
        });
        return grouped;
    }, [currentProject?.video_tasks]);

    const handleSelectVideo = async (frameId: string, videoId: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.selectVideo(currentProject.id, frameId, videoId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to select video:", error);
        }
    };

    const handleMerge = async () => {
        if (!currentProject) return;
        setIsMerging(true);
        setMergeError(null);  // Clear previous errors

        try {
            const updatedProject = await api.mergeVideos(currentProject.id);
            updateProject(currentProject.id, updatedProject);
            // Success - error will be null, merged video will show below
        } catch (error: any) {
            console.error("Failed to merge videos:", error);

            // Extract detailed error message from backend
            const errorDetail = extractErrorDetail(error, "Unknown error occurred during video merge");

            setMergeError(errorDetail);

            // Also show alert for immediate feedback
            alert(`${ta("mergeFailedAlert")}:\n\n${errorDetail}`);
        } finally {
            setIsMerging(false);
        }
    };

    const handleCreatePlan = () => {
        if (!currentProject) return;
        setPlanError(null);
        setAssemblyPlan(buildDraftAssemblyPlan(currentProject));
    };

    const handleSavePlan = async () => {
        if (!currentProject || !assemblyPlan) return;
        setIsSavingPlan(true);
        setPlanError(null);
        try {
            const saved = await api.saveAssemblyPlan("project", currentProject.id, assemblyPlan);
            setAssemblyPlan(saved);
            updateProject(currentProject.id, { assembly_plan: saved });
        } catch (error) {
            setPlanError(extractErrorDetail(error, "Assembly plan could not be saved"));
        } finally {
            setIsSavingPlan(false);
        }
    };


    const handleDownload = async () => {
        if (!currentProject?.merged_video_url) return;
        setIsDownloading(true);
        try {
            // Build download URL - use proxy in dev to avoid CORS, direct in production
            const rawPath = currentProject.merged_video_url;
            const cleanPath = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
            const isDev = process.env.NODE_ENV === "development";
            const url = isDev
                ? `/api-proxy/files/${cleanPath}`
                : getAssetUrl(rawPath);

            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = `${currentProject.title || "merged"}_${currentProject.id}.mp4`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        } catch (error) {
            console.error("Failed to download video:", error);
            alert(ta("downloadFailed"));
        } finally {
            setIsDownloading(false);
        }
    };

    const selectedFrame = useMemo(() => {
        return currentProject?.frames?.find((f: any) => f.id === selectedFrameId);
    }, [currentProject?.frames, selectedFrameId]);

    const variants = selectedFrameId ? videosByFrame[selectedFrameId] || [] : [];

    const frames = (currentProject?.frames ?? []) as any[];
    const videoTasks = (currentProject?.video_tasks ?? []) as any[];
    const {
        ready: framesReady,
        total: framesTotal,
        missing: framesMissing,
    } = getAssemblyReadiness(frames, videoTasks);

    return (
        // Layout v4: outer horizontal split. StepHeader belongs to main
        // column; right Variants panel is floor-to-ceiling with its own
        // SidePanelHeader.
        <div className="h-full flex overflow-hidden">
            {/* Left: main column */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <StepPageHeader
                    stepNumber={5}
                    englishName="ASSEMBLY"
                    title={tStep("assemblyTitle")}
                    subtitle={tStep("assemblySubtitle")}
                    pills={framesTotal > 0 ? (
                        <>
                            <StepPill label={ta("framesLabel")} value={framesTotal} />
                            <StepPill label={ta("framesReadyLabel")} value={`${framesReady}/${framesTotal}`} />
                        </>
                    ) : null}
                />
                {/* PR-3k · Phase tabs — Takes / Mix / Export */}
                <div className="flex items-center gap-1 px-6 pt-2 border-b border-glass-border bg-surface">
                    {[
                        { id: "timeline" as const, label: ta("phaseTimeline"), icon: <Layout size={12} /> },
                        { id: "takes" as const,  label: ta("phaseTakes"),  icon: <Film size={12} /> },
                        { id: "mix" as const,    label: ta("phaseMix"),    icon: <Sliders size={12} /> },
                        { id: "export" as const, label: ta("phaseExport"), icon: <Package size={12} /> },
                    ].map((p) => (
                        <button
                            key={p.id}
                            onClick={() => setPhase(p.id)}
                            className={`relative inline-flex items-center gap-1.5 px-3 pb-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em] transition-colors ${
                                phase === p.id
                                    ? "text-foreground"
                                    : "text-text-muted hover:text-text-secondary"
                            }`}
                        >
                            {p.icon}
                            {p.label}
                            {phase === p.id && (
                                <span className="absolute bottom-0 left-2 right-2 h-px bg-primary" aria-hidden="true" />
                            )}
                        </button>
                    ))}
                </div>
                {phase === "timeline" && (
                    <AssemblyPlanPhase
                        project={currentProject}
                        plan={assemblyPlan}
                        isSaving={isSavingPlan}
                        error={planError}
                        onCreate={handleCreatePlan}
                        onChange={setAssemblyPlan}
                        onSave={handleSavePlan}
                    />
                )}
                {phase === "takes" && (
                    <div
                        role="status"
                        className="mx-6 mt-3 flex items-center gap-2 rounded-lg border border-glass-border bg-glass px-3 py-2 text-xs text-text-secondary"
                    >
                        <Film size={13} className="shrink-0 text-primary" aria-hidden="true" />
                        <span>{ta("selectFrameHint")}</span>
                    </div>
                )}
                {/* Takes phase body */}
                {phase === "takes" && (
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                        {currentProject?.frames?.map((frame: any, index: number) => {
                            const hasVideos = videosByFrame[frame.id]?.length > 0;
                            const isSelected = frame.id === selectedFrameId;
                            const selectedVideo = resolveAssemblyVideo(frame, videoTasks);

                            return (
                                <motion.div
                                    key={frame.id}
                                    layoutId={`frame-${frame.id}`}
                                    onClick={() => setSelectedFrameId(frame.id)}
                                    className={`group relative flex rounded-xl overflow-hidden cursor-pointer border transition-all bg-glass hover:bg-hover-bg ${isSelected ? "border-primary ring-1 ring-primary/50" :
                                        selectedVideo ? "border-green-500/30" : "border-glass-border"
                                        }`}
                                >
                                    {/* Left: Preview */}
                                    <div className="w-48 aspect-video relative flex-shrink-0 border-r border-glass-border bg-elevated">
                                        {selectedVideo ? (
                                            <video
                                                src={getAssetUrl(selectedVideo.video_url)}
                                                className="w-full h-full object-cover"
                                                muted
                                                onMouseOver={(e) => e.currentTarget.play()}
                                                onMouseOut={(e) => {
                                                    e.currentTarget.pause();
                                                    e.currentTarget.currentTime = 0;
                                                }}
                                            />
                                        ) : (
                                            <div className="w-full h-full relative">
                                                {frame.image_url ? (
                                                    <img
                                                        src={getAssetUrl(frame.image_url)}
                                                        className="w-full h-full object-cover opacity-50 grayscale"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full bg-glass" />
                                                )}
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    {hasVideos ? (
                                                        <div className="bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded text-xs font-bold border border-yellow-500/50">
                                                            {ta("selectVideo")}
                                                        </div>
                                                    ) : (
                                                        <div className="bg-red-500/20 text-red-500 px-2 py-1 rounded text-xs font-bold border border-red-500/50">
                                                            {ta("noVideos")}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        <div className="absolute top-2 left-2 bg-surface px-2 py-0.5 rounded text-[0.625rem] font-mono text-foreground">
                                            #{index + 1}
                                        </div>
                                    </div>

                                    {/* Right: Details */}
                                    <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                                        <div className="space-y-2">
                                            <div className="flex items-start gap-2">
                                                <FileText size={14} className="text-text-muted mt-0.5 flex-shrink-0" />
                                                <p className="text-sm text-text-secondary line-clamp-2 leading-relaxed">
                                                    {frame.image_prompt || frame.action_description || ta("noPrompt")}
                                                </p>
                                            </div>
                                            {frame.dialogue && (
                                                <div className="flex items-start gap-2 pl-6 border-l-2 border-glass-border ml-1">
                                                    <p className="text-xs text-text-secondary italic">"{frame.dialogue}"</p>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-subtle">
                                            <div className="flex items-center gap-4 text-xs text-text-muted">
                                                <span className="flex items-center gap-1">
                                                    <Clock size={12} /> {selectedVideo?.duration ? `${selectedVideo.duration}s` : "--"}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Film size={12} /> {videosByFrame[frame.id]?.length || 0} {ta("variants")}
                                                </span>
                                            </div>

                                            {selectedVideo && (
                                                <div className="flex items-center gap-1 text-green-500 text-xs font-bold">
                                                    <Check size={12} /> Ready
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                </div>
                )}

                {/* Mix phase body — BGM picker + per-track volume sliders */}
                {phase === "mix" && (
                    <MixPhase scriptId={currentProject?.id ?? null}
                              bgmUrl={currentProject?.bgm_url ?? null}
                              mixSettings={currentProject?.mix_settings as Record<string, number> | undefined}
                              onChange={(updated) => currentProject && updateProject(currentProject.id, updated)}
                    />
                )}

                {/* Export phase body — merge action + final preview + download */}
                {phase === "export" && (
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-6">
                        <ExportPhase
                            mergedVideoUrl={currentProject?.merged_video_url ?? null}
                            isMerging={isMerging}
                            isDownloading={isDownloading}
                            mergeError={mergeError}
                            framesReady={framesReady}
                            framesTotal={framesTotal}
                            framesMissing={framesMissing}
                            onMerge={handleMerge}
                            onDownload={handleDownload}
                            onDismissError={() => setMergeError(null)}
                        />
                    </div>
                )}
                </div>

            {/* Right Sidebar - Variants — only visible in Takes phase */}
            {phase === "takes" && (
            <div className="w-[360px] shrink-0 bg-surface flex flex-col z-10 border-l border-glass-border overflow-hidden">
                <SidePanelHeader
                    icon={<Film />}
                    title={ta("variants")}
                    subtitle={selectedFrameId
                        ? `Frame #${(currentProject?.frames?.findIndex((f: any) => f.id === selectedFrameId) ?? -1) + 1}`
                        : undefined}
                />
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                        {selectedFrameId ? (
                            <div className="space-y-4">
                                {variants.length > 0 ? (
                                    variants.map((video: any, idx: number) => {
                                        const activeVideo = selectedFrame
                                            ? resolveAssemblyVideo(selectedFrame, videoTasks)
                                            : null;
                                        const isSelected = activeVideo?.id === video.id;
                                        return (
                                            <div
                                                key={video.id}
                                                className={`rounded-xl overflow-hidden border transition-all group ${isSelected ? "border-green-500 ring-1 ring-green-500/50 bg-green-500/5" : "border-glass-border bg-glass hover:border-glass-border"
                                                    }`}
                                            >
                                                <div className="aspect-video relative bg-black">
                                                    <video
                                                        src={getAssetUrl(
                                                            selectedFrame?.dubbed_video_task_id === video.id && selectedFrame?.dubbed_video_url
                                                                ? selectedFrame.dubbed_video_url
                                                                : video.video_url
                                                        )}
                                                        className="w-full h-full object-contain"
                                                        controls
                                                    />
                                                    {/* Overlay Info */}
                                                    <div className="absolute top-2 left-2 bg-surface px-1.5 rounded text-[0.625rem] text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {video.duration}s
                                                    </div>
                                                </div>
                                                <div className="p-3">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="text-xs text-text-secondary">
                                                            Variant #{idx + 1}
                                                        </div>
                                                        <div className="text-[0.625rem] px-1.5 py-0.5 rounded bg-hover-bg text-text-secondary">
                                                            {video.model}
                                                        </div>
                                                    </div>

                                                    {isSelected ? (
                                                        <div className="w-full py-2 bg-green-500/10 text-green-500 rounded-lg text-xs font-bold flex items-center justify-center gap-2 border border-green-500/20">
                                                            <Check size={14} /> {ta("selected")}
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleSelectVideo(selectedFrameId, video.id)}
                                                            className="w-full py-2 bg-hover-bg hover:bg-hover-bg rounded-lg text-xs font-medium transition-colors text-foreground"
                                                        >
                                                            {ta("selectThisVariant")}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="text-center py-12 text-text-muted flex flex-col items-center">
                                        <AlertTriangle className="mb-3 opacity-50" size={32} />
                                        <p className="text-sm font-medium">{ta("noVideosGenerated")}</p>
                                        <p className="text-xs mt-1 max-w-[200px]">{ta("noVideosHint")}</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3">
                                <Layout size={48} className="opacity-10" />
                                <p className="text-sm">{ta("selectFrameHint")}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────
// PR-3k · Phase sub-components
// ──────────────────────────────────────────────────────────────────

export function AssemblyPlanPhase({
    project,
    plan,
    isSaving,
    error,
    onCreate,
    onChange,
    onSave,
    readyCountOverride,
}: {
    project: Project | null;
    plan: AssemblyEditPlan | null;
    isSaving: boolean;
    error: string | null;
    onCreate: () => void;
    onChange: (plan: AssemblyEditPlan | null) => void;
    onSave: () => void;
    readyCountOverride?: number;
}) {
    const ta = useTranslations("assembly");
    const readyCount = readyCountOverride ?? (project?.frames ?? []).filter((frame: any) =>
        resolveAssemblyVideo(frame, project?.video_tasks ?? []),
    ).length;

    if (!plan) {
        return (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                <section className="max-w-3xl rounded-lg border border-glass-border bg-glass p-5">
                    <div className="flex items-start gap-3">
                        <Layout size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                        <div className="min-w-0">
                            <h3 className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-text-muted">
                                {ta("planTitle")}
                            </h3>
                            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                                {ta("planEmpty")}
                            </p>
                            <button
                                type="button"
                                onClick={onCreate}
                                disabled={readyCount === 0}
                                className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Plus size={14} aria-hidden="true" />
                                {ta("createPlan")}
                            </button>
                            <p className="mt-2 text-[0.6875rem] text-text-muted">
                                {ta("readySourceCount", { count: readyCount })}
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        );
    }

    const updateTarget = (value: number) => {
        const target = Math.max(1_000, Math.min(3_600_000, Math.round(value * 1000)));
        onChange({ ...plan, target_duration_ms: target });
    };

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-glass-border pb-4">
                <div>
                    <h3 className="flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-text-muted">
                        <Layout size={13} className="text-primary" aria-hidden="true" />
                        {ta("planTitle")}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                        {ta("planRevision", { revision: plan.revision })}
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <label className="flex flex-col gap-1 text-[0.625rem] uppercase tracking-[0.14em] text-text-muted">
                        {ta("targetSeconds")}
                        <input
                            aria-label={ta("targetSeconds")}
                            type="number"
                            min={1}
                            max={3600}
                            step={1}
                            value={Math.round(plan.target_duration_ms / 1000)}
                            onChange={(event) => updateTarget(Number(event.target.value) || 1)}
                            className="w-24 rounded-md border border-glass-border bg-elevated px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={isSaving}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
                        {isSaving ? ta("savingPlan") : ta("savePlan")}
                    </button>
                </div>
            </div>

            {error && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-200">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                </div>
            )}

            <p className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-100/85">
                {ta("planCompileNotice")}
            </p>

            <div className="rounded-md border border-glass-border bg-elevated px-3 py-2 font-mono text-[0.6875rem] text-text-muted">
                <div className="flex items-center justify-between gap-3">
                    <span>0:00</span>
                    <span>{formatAssemblyTime(plan.target_duration_ms)}</span>
                </div>
                <div className="mt-2 h-1 rounded-full bg-glass-border" aria-hidden="true">
                    <div className="h-full w-full rounded-full bg-primary/60" />
                </div>
            </div>

            <div className="space-y-3">
                {plan.lanes.map((lane) => (
                    <section key={lane.id} className="rounded-lg border border-glass-border bg-glass">
                        <div className="flex items-center justify-between border-b border-glass-border px-3 py-2">
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground">
                                    {lane.label || lane.kind}
                                </span>
                                <span className="text-[0.625rem] text-text-muted">{lane.clips.length}</span>
                            </div>
                            <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">
                                {lane.kind}
                            </span>
                        </div>
                        {lane.clips.length === 0 ? (
                            <p className="px-3 py-3 text-xs text-text-muted">{ta("laneEmpty")}</p>
                        ) : (
                            <div className="divide-y divide-glass-border">
                                {lane.clips.map((clip, clipIndex) => (
                                    <AssemblyClipRow
                                        key={clip.id}
                                        clip={clip}
                                        index={clipIndex}
                                        total={lane.clips.length}
                                        onChange={(patch) => onChange(updateAssemblyClip(plan, lane.id, clip.id, patch))}
                                        onMove={(direction) => onChange(moveAssemblyClip(plan, lane.id, clip.id, direction))}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                ))}
            </div>

            {plan.markers.length > 0 && (
                <section className="rounded-lg border border-glass-border bg-glass">
                    <div className="border-b border-glass-border px-3 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-text-muted">
                        {ta("markers")}
                    </div>
                    <div className="divide-y divide-glass-border">
                        {plan.markers.map((marker) => (
                            <div key={marker.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                                <span className="min-w-0 truncate text-text-secondary">{marker.label}</span>
                                <span className="shrink-0 font-mono text-[0.6875rem] text-text-muted">{formatAssemblyTime(marker.time_ms)}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

function AssemblyClipRow({
    clip,
    index,
    total,
    onChange,
    onMove,
}: {
    clip: AssemblyClip;
    index: number;
    total: number;
    onChange: (patch: Partial<AssemblyClip>) => void;
    onMove: (direction: -1 | 1) => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <label className="inline-flex min-h-10 items-center gap-2 text-xs text-text-secondary">
                <input
                    type="checkbox"
                    checked={clip.enabled}
                    onChange={(event) => onChange({ enabled: event.target.checked })}
                    aria-label={`Enable ${clip.label || clip.id}`}
                    className="h-4 w-4 accent-primary"
                />
                <span className="max-w-48 truncate">{clip.label || clip.id}</span>
            </label>
            <div className="ml-auto flex items-center gap-2 font-mono text-[0.6875rem] text-text-muted">
                <label className="flex items-center gap-1">
                    <span className="sr-only">Start milliseconds</span>
                    <input
                        type="number"
                        min={0}
                        value={clip.timeline_start_ms}
                        onChange={(event) => onChange({ timeline_start_ms: Number(event.target.value) || 0 })}
                        aria-label={`${clip.label || clip.id} start milliseconds`}
                        className="w-24 rounded border border-glass-border bg-elevated px-1.5 py-1 text-right text-[0.6875rem] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                </label>
                <span>→</span>
                <label className="flex items-center gap-1">
                    <span className="sr-only">End milliseconds</span>
                    <input
                        type="number"
                        min={1}
                        value={clip.timeline_end_ms}
                        onChange={(event) => onChange({ timeline_end_ms: Number(event.target.value) || 1 })}
                        aria-label={`${clip.label || clip.id} end milliseconds`}
                        className="w-24 rounded border border-glass-border bg-elevated px-1.5 py-1 text-right text-[0.6875rem] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                </label>
                <span className="w-12 text-right">{formatAssemblyTime(clip.timeline_end_ms - clip.timeline_start_ms)}</span>
            </div>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => onMove(-1)}
                    disabled={index === 0}
                    aria-label={`Move ${clip.label || clip.id} earlier`}
                    className="grid h-9 w-9 place-items-center rounded border border-glass-border text-text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                    <ArrowUp size={13} aria-hidden="true" />
                </button>
                <button
                    type="button"
                    onClick={() => onMove(1)}
                    disabled={index === total - 1}
                    aria-label={`Move ${clip.label || clip.id} later`}
                    className="grid h-9 w-9 place-items-center rounded border border-glass-border text-text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                    <ArrowDown size={13} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}

function MixPhase({
    scriptId,
    bgmUrl,
    mixSettings,
    onChange,
}: {
    scriptId: string | null;
    bgmUrl: string | null;
    mixSettings: Record<string, number> | undefined;
    onChange: (updated: { bgm_url?: string | null; mix_settings?: Record<string, number> }) => void;
}) {
    const ta = useTranslations("assembly");
    const [presets, setPresets] = useState<BgmPreset[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const mix = mixSettings ?? { dialogue: 100, bgm: 35, sfx: 60 };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.listBgmPresets()
            .then((p) => { if (!cancelled) setPresets(p); })
            .catch(() => { if (!cancelled) setPresets([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const handlePick = async (preset: BgmPreset | null) => {
        if (!scriptId) return;
        setSaving(true);
        try {
            const updated = await api.updateAudioMix(scriptId, { bgm_url: preset ? preset.url : null });
            onChange({ bgm_url: updated.bgm_url, mix_settings: updated.mix_settings });
        } finally {
            setSaving(false);
        }
    };

    const handleVolume = async (track: "dialogue" | "bgm" | "sfx", value: number) => {
        if (!scriptId) return;
        // Optimistic update for snappy slider
        onChange({ mix_settings: { ...mix, [track]: value } });
        try {
            const payload: Record<string, number> = {};
            payload[`${track}_volume`] = value;
            await api.updateAudioMix(scriptId, payload as any);
        } catch (_) {
            // Revert handled by next project refresh — keep silent for v1
        }
    };

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-8">
            {/* BGM picker */}
            <section>
                <h3 className="mb-3 flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-text-muted">
                    <Music size={12} className="text-primary" />
                    {ta("mixBgmTitle")}
                    {saving && <Loader2 size={12} className="animate-spin text-primary" />}
                </h3>
                {/* Preview banner — backend amix is wired (pipeline.merge_videos),
                    but the preset audio files aren't shipped yet, so the merged
                    output today is silent regardless of selection. We surface
                    this honestly so users don't keep selecting BGM and wondering
                    why the export has no music. */}
                <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400/85" aria-hidden="true" />
                    <p className="text-[0.71875rem] leading-relaxed text-amber-100/85">
                        {ta("mixBgmPreviewNotice")}
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    <button
                        onClick={() => handlePick(null)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                            !bgmUrl
                                ? "border-primary bg-[rgba(100,108,255,0.10)]"
                                : "border-glass-border bg-glass hover:border-foreground/30"
                        }`}
                    >
                        <p className="text-[0.8125rem] font-medium text-foreground">{ta("mixBgmNone")}</p>
                        <p className="mt-0.5 font-mono text-[0.59375rem] uppercase tracking-[0.14em] text-text-muted">silent</p>
                    </button>
                    {loading ? (
                        <div className="col-span-3 grid place-items-center py-4 text-text-muted">
                            <Loader2 size={16} className="animate-spin" />
                        </div>
                    ) : (
                        presets.map((p) => {
                            const selected = bgmUrl === p.url;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => handlePick(p)}
                                    className={`rounded-lg border p-3 text-left transition-colors ${
                                        selected
                                            ? "border-primary bg-[rgba(100,108,255,0.10)]"
                                            : "border-glass-border bg-glass hover:border-foreground/30"
                                    }`}
                                >
                                    <p className="text-[0.8125rem] font-medium text-foreground truncate">{p.label}</p>
                                    <p className="mt-0.5 font-mono text-[0.59375rem] uppercase tracking-[0.14em] text-text-muted">{p.mood}</p>
                                </button>
                            );
                        })
                    )}
                </div>
            </section>

            {/* Volume sliders */}
            <section>
                <h3 className="mb-3 flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-text-muted">
                    <Sliders size={12} className="text-primary" />
                    {ta("mixLevelsTitle")}
                </h3>
                <div className="space-y-3 max-w-lg">
                    {(["dialogue", "bgm", "sfx"] as const).map((track) => (
                        <div key={track} className="flex items-center gap-3">
                            <span className="w-20 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-text-muted">{ta(`mixTrack.${track}`)}</span>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={mix[track] ?? 0}
                                onChange={(e) => handleVolume(track, Number(e.target.value))}
                                className="flex-1 accent-primary"
                            />
                            <span className="w-12 text-right font-mono text-[0.6875rem] text-text-secondary">{mix[track] ?? 0}</span>
                        </div>
                    ))}
                </div>
                <p className="mt-3 text-[0.6875rem] text-text-muted max-w-lg">
                    {ta("mixHint")}
                </p>
            </section>
        </div>
    );
}

function ExportPhase({
    mergedVideoUrl,
    isMerging,
    isDownloading,
    mergeError,
    framesReady,
    framesTotal,
    framesMissing,
    onMerge,
    onDownload,
    onDismissError,
}: {
    mergedVideoUrl: string | null;
    isMerging: boolean;
    isDownloading: boolean;
    mergeError: string | null;
    framesReady: number;
    framesTotal: number;
    framesMissing: number;
    onMerge: () => void;
    onDownload: () => void;
    onDismissError: () => void;
}) {
    const ta = useTranslations("assembly");
    const canMerge = framesTotal > 0 && framesReady > 0;
    return (
        <div className="space-y-6 max-w-3xl">
            <section className="rounded-xl border border-glass-border bg-glass p-6">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h3 className="text-display font-medium text-foreground flex items-center gap-2">
                            <Package size={16} className="text-primary" />
                            {ta("exportTitle")}
                        </h3>
                        <p className="mt-1 text-body-sm text-text-secondary">
                            {ta("exportSubtitle", { ready: framesReady, total: framesTotal })}
                        </p>
                        {framesMissing > 0 && (
                            <p className="mt-2 text-xs text-amber-300/90">
                                {ta("partialExportWarning", { missing: framesMissing })}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={onMerge}
                        disabled={isMerging || !canMerge}
                        className="shrink-0 inline-flex items-center gap-2 bg-primary text-white border border-[rgba(100,108,255,0.65)] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14)] hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 rounded-md font-semibold text-[0.8125rem]"
                    >
                        {isMerging ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
                        {ta("mergeAndProceed")}
                    </button>
                </div>
            </section>

            {mergeError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-bold text-red-400 mb-1">{ta("mergeFailed")}</h4>
                            <p className="text-xs text-red-300/90 whitespace-pre-wrap leading-relaxed font-mono break-all">
                                {mergeError}
                            </p>
                            {mergeError.toLowerCase().includes("ffmpeg") && (
                                <a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 underline mt-2 inline-block">
                                    Download FFmpeg →
                                </a>
                            )}
                            <button onClick={onDismissError} className="mt-3 text-xs text-text-secondary hover:text-foreground underline">
                                {ta("dismiss")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <AnimatePresence>
                {mergedVideoUrl && (
                    <motion.section
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="rounded-xl border border-glass-border bg-elevated overflow-hidden"
                    >
                        <div className="grid md:grid-cols-2 gap-0">
                            <div className="aspect-video bg-black">
                                <video src={getAssetUrl(mergedVideoUrl)} className="w-full h-full object-contain" controls autoPlay />
                            </div>
                            <div className="p-5 flex flex-col justify-center gap-3">
                                <div>
                                    <h3 className="text-display font-medium text-foreground flex items-center gap-2">
                                        <Check className="text-green-500" size={16} />
                                        {ta("mergedVideoReady")}
                                    </h3>
                                    <p className="text-body-sm text-text-secondary mt-1">{ta("mergedVideoDesc")}</p>
                                </div>
                                <button
                                    onClick={onDownload}
                                    disabled={isDownloading}
                                    className="self-start inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-glass border border-glass-border text-foreground hover:bg-hover-bg transition-colors text-[0.8125rem] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Download size={14} />
                                    {isDownloading ? ta("downloading") : ta("downloadMP4")}
                                </button>
                            </div>
                        </div>
                    </motion.section>
                )}
            </AnimatePresence>
        </div>
    );
}
