"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    Check,
    CheckCircle2,
    Clapperboard,
    ChevronDown,
    ChevronUp,
    Clock3,
    Loader2,
    Plus,
    RotateCcw,
    Save,
    Sparkles,
    Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type {
    DirectorPlanBeat,
    DirectorPlanDialogueLine,
    DirectorPlanScene,
    DirectorPlanShot,
    DirectorShootingPlan,
    DirectorShootingPlanRevisionSummary,
    DirectorShootingPlanState,
} from "@/lib/directorShootingPlan";
import { useProjectStore } from "@/store/projectStore";
import { extractErrorDetail } from "@/lib/utils";

type Action = "load" | "generate" | "save" | "confirm" | "restore" | null;

const emptyLighting = () => ({ key_source: "", color_tone: "", contrast: "", practical_sources: [] as string[] });
const newId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const planFingerprint = (plan: DirectorShootingPlan | null) => plan ? JSON.stringify(plan) : "";

function emptyShot(order: number): DirectorPlanShot {
    return {
        shot_id: newId("plan-shot"), order, title: "", visual_intent: "", performance_action: "",
        action_physics: "", shot_size: "", camera_angle: "", composition: "", camera_movement: "",
        lighting: emptyLighting(), duration_seconds: 3, dialogue: [], ambient_sound: "",
        character_ids: [], prop_ids: [],
    };
}

function emptyBeat(order: number): DirectorPlanBeat {
    return {
        beat_id: newId("plan-beat"), order, title: "", dramatic_purpose: "", emotional_change: "",
        duration_seconds: null, keep_with_next: false, source_chunk_refs: [],
        story_event_ids: [], shots: [emptyShot(0)],
    };
}

function emptyScene(order: number): DirectorPlanScene {
    return {
        scene_id: newId("plan-scene"), order, scene_ref: "", heading: "", location: "", time_anchor: "",
        continues_previous_scene: false, continuity_in: "", continuity_out: "", duration_seconds: null,
        environment_atmosphere: "", unresolved_questions: [], source_chunk_refs: [], prop_ids: [],
        beats: [emptyBeat(0)],
    };
}

function emptyPlan(lineage: Record<string, unknown>): DirectorShootingPlan {
    return {
        schema_version: 1,
        source_revision: Number(lineage.source_revision ?? 1),
        source_revision_id: String(lineage.source_revision_id ?? ""),
        director_profile_revision: Number(lineage.director_profile_revision ?? 1),
        director_profile_hash: String(lineage.director_profile_hash ?? ""),
        effective_style_hash: String(lineage.effective_style_hash ?? ""),
        scenes: [emptyScene(0)],
        unresolved_questions: [],
        generated_at: null,
    };
}

function reindex<T extends { order: number }>(items: T[]): T[] {
    return items.map((item, order) => ({ ...item, order }));
}

function Field({
    label,
    value,
    onChange,
    multiline = false,
    type = "text",
    min,
    max,
    hint,
}: {
    label: string;
    value: string | number | null;
    onChange: (value: string) => void;
    multiline?: boolean;
    type?: string;
    min?: number;
    max?: number;
    hint?: string;
}) {
    const id = useId();
    return (
        <div className="min-w-0">
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-text-secondary">{label}</label>
            {multiline ? (
                <textarea
                    id={id}
                    value={value ?? ""}
                    onChange={event => onChange(event.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
            ) : (
                <input
                    id={id}
                    type={type}
                    min={min}
                    max={max}
                    step={type === "number" ? 1 : undefined}
                    value={value ?? ""}
                    onChange={event => onChange(event.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
            )}
            {hint && <p className="mt-1 text-xs leading-5 text-text-muted">{hint}</p>}
        </div>
    );
}

function MultiSelect({
    label,
    values,
    options,
    onChange,
}: {
    label: string;
    values: string[];
    options: { id: string; label: string }[];
    onChange: (values: string[]) => void;
}) {
    const id = useId();
    return (
        <div className="min-w-0">
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-text-secondary">{label}</label>
            <select
                id={id}
                multiple
                value={values}
                onChange={event => onChange(Array.from(event.currentTarget.selectedOptions, option => option.value))}
                className="min-h-24 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            >
                {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            {options.length === 0 && <p className="mt-1 text-xs text-text-muted">—</p>}
        </div>
    );
}

function moveItem<T>(items: T[], index: number, delta: number): T[] {
    const target = index + delta;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

export default function DirectorShootingPlanPanel() {
    const t = useTranslations("artDirection.directorPlan");
    const { currentProject } = useProjectStore();
    const projectId = currentProject?.id;
    const confirmedProfile = currentProject?.art_direction?.director_profile;
    const examples = Array.isArray(confirmedProfile?.sample_plan)
        ? confirmedProfile.sample_plan.filter(value => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown>[]
        : [];

    const [serverState, setServerState] = useState<DirectorShootingPlanState | null>(null);
    const [plan, setPlan] = useState<DirectorShootingPlan | null>(null);
    const [savedPlan, setSavedPlan] = useState<DirectorShootingPlan | null>(null);
    const [history, setHistory] = useState<DirectorShootingPlanRevisionSummary[]>([]);
    const [action, setAction] = useState<Action>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [jobProgress, setJobProgress] = useState<{ completed: number; total: number } | null>(null);
    const [jobStatus, setJobStatus] = useState("");
    const [expandedShots, setExpandedShots] = useState<Set<string>>(() => new Set());
    const [sourceEditorSceneId, setSourceEditorSceneId] = useState<string | null>(null);

    const sourceRevision = currentProject?.source_revision ?? 1;
    const styleToken = JSON.stringify(currentProject?.art_direction?.style_config ?? {
        style_preset: currentProject?.style_preset,
        style_prompt: currentProject?.style_prompt,
    });
    const dirty = useMemo(() => planFingerprint(plan) !== planFingerprint(savedPlan), [plan, savedPlan]);
    const scenes = plan?.scenes ?? [];
    const beats = scenes.flatMap(scene => scene.beats);
    const shots = beats.flatMap(beat => beat.shots);
    const duration = shots.reduce((total, shot) => total + (shot.duration_seconds ?? 0), 0);
    const localDirtyRef = useRef(dirty);
    localDirtyRef.current = dirty;
    const activeProjectId = useRef<string | undefined>(projectId);
    const storyEventOptions = confirmedProfile?.story_map?.phases.flatMap(phase =>
        phase.events.map(event => ({ id: event.event_id, label: `${phase.label} · ${event.title || event.description.slice(0, 48)}` })),
    ) ?? [];
    const characterOptions = (currentProject?.characters ?? []).map(item => ({ id: item.id, label: `${item.name}${item.persona ? ` · ${item.persona}` : ""}` }));
    const propOptions = (currentProject?.props ?? []).map(item => ({ id: item.id, label: item.name }));

    const load = useCallback(async (preserveLocal = false) => {
        if (!projectId) return;
        setAction("load");
        setError("");
        try {
            const [nextState, nextHistory] = await Promise.all([
                api.getDirectorShootingPlan(projectId),
                api.listDirectorShootingPlanRevisions(projectId),
            ]);
            setServerState(nextState);
            if (!preserveLocal || !localDirtyRef.current) {
                setPlan(nextState.draft);
                setSavedPlan(nextState.draft);
                setExpandedShots(new Set());
            }
            setHistory(nextHistory);
        } catch (cause) {
            setError(extractErrorDetail(cause) || t("loadFailed"));
        } finally {
            setAction(null);
        }
    }, [projectId, t]);

    useEffect(() => {
        const changedProject = activeProjectId.current !== projectId;
        if (changedProject) {
            activeProjectId.current = projectId;
            setServerState(null);
            setPlan(null);
            setSavedPlan(null);
            setHistory([]);
            setExpandedShots(new Set());
            setSourceEditorSceneId(null);
            setError("");
            setNotice("");
        }
        void load(!changedProject);
    }, [load, sourceRevision, confirmedProfile?.revision, confirmedProfile?.content_hash, styleToken]);

    const updatePlan = (update: (current: DirectorShootingPlan) => DirectorShootingPlan) => {
        setPlan(current => current ? update(current) : current);
        setNotice("");
    };

    const updateScene = (sceneIndex: number, patch: Partial<DirectorPlanScene>) => updatePlan(current => ({
        ...current,
        scenes: current.scenes.map((scene, index) => index === sceneIndex ? { ...scene, ...patch } : scene),
    }));

    const updateBeat = (sceneIndex: number, beatIndex: number, patch: Partial<DirectorPlanBeat>) => updatePlan(current => ({
        ...current,
        scenes: current.scenes.map((scene, index) => index === sceneIndex ? {
            ...scene,
            beats: scene.beats.map((beat, innerIndex) => innerIndex === beatIndex ? { ...beat, ...patch } : beat),
        } : scene),
    }));

    const updateShot = (sceneIndex: number, beatIndex: number, shotIndex: number, patch: Partial<DirectorPlanShot>) => updatePlan(current => ({
        ...current,
        scenes: current.scenes.map((scene, index) => index === sceneIndex ? {
            ...scene,
            beats: scene.beats.map((beat, innerIndex) => innerIndex === beatIndex ? {
                ...beat,
                shots: beat.shots.map((shot, shotInnerIndex) => shotInnerIndex === shotIndex ? { ...shot, ...patch } : shot),
            } : beat),
        } : scene),
    }));

    const generate = async () => {
        if (!projectId) return;
        setAction("generate");
        setError("");
        setNotice("");
        setJobProgress(null);
        try {
            const generated = await api.generateDirectorShootingPlan(projectId, job => {
                setJobStatus(job.status);
                setJobProgress(job.progress ?? null);
            });
            setPlan(generated);
            setSavedPlan(null);
            setNotice(t("generated"));
            setServerState(previous => previous ? { ...previous, draft_stale: false } : previous);
        } catch (cause) {
            setError(extractErrorDetail(cause) || t("generateFailed"));
        } finally {
            setAction(null);
            setJobStatus("");
        }
    };

    const createBlank = () => {
        if (!serverState?.current_lineage) return;
        setPlan(emptyPlan(serverState.current_lineage));
        setSavedPlan(null);
        setError("");
        setNotice(t("blankCreated"));
    };

    const save = async () => {
        if (!projectId || !plan) return;
        setAction("save");
        setError("");
        try {
            const result = await api.saveDirectorShootingPlanDraft(projectId, sourceRevision, serverState?.draft_revision ?? 0, plan);
            setPlan(result.draft);
            setSavedPlan(result.draft);
            setServerState(previous => previous ? {
                ...previous,
                draft: result.draft,
                draft_revision: result.draft_revision,
                draft_updated_at: result.draft_updated_at,
                draft_stale: false,
            } : previous);
            setNotice(t("draftSaved", { revision: result.draft_revision }));
        } catch (cause) {
            setError(extractErrorDetail(cause) || t("saveFailed"));
        } finally {
            setAction(null);
        }
    };

    const confirmPlan = async () => {
        if (!projectId || !plan) return;
        setAction("confirm");
        setError("");
        try {
            const result = await api.confirmDirectorShootingPlan(
                projectId,
                serverState?.current_revision ?? 0,
                serverState?.draft_revision ?? 0,
                plan,
            );
            setNotice(t("confirmed", { revision: result.current_revision }));
            await load();
        } catch (cause) {
            setError(extractErrorDetail(cause) || t("confirmFailed"));
        } finally {
            setAction(null);
        }
    };

    const restore = async (revision: number) => {
        if (!projectId || !serverState || dirty) return;
        setAction("restore");
        setError("");
        try {
            const result = await api.restoreDirectorShootingPlanRevision(
                projectId,
                revision,
                serverState.draft_revision,
            );
            setPlan(result.draft);
            setSavedPlan(result.draft);
            setServerState(previous => previous ? {
                ...previous,
                draft: result.draft,
                draft_revision: result.draft_revision,
                draft_updated_at: result.draft_updated_at,
                draft_stale: false,
            } : previous);
            setNotice(t("restored", { revision }));
        } catch (cause) {
            setError(extractErrorDetail(cause) || t("restoreFailed"));
        } finally {
            setAction(null);
        }
    };

    if (!currentProject) {
        return <p className="rounded-lg border border-border p-5 text-sm text-text-secondary">{t("noProject")}</p>;
    }

    const locked = action !== null;
    const localPlanStale = Boolean(plan && (
        plan.source_revision !== serverState?.current_lineage?.source_revision
        || plan.source_revision_id !== serverState?.current_lineage?.source_revision_id
        || plan.director_profile_revision !== serverState?.current_lineage?.director_profile_revision
        || plan.director_profile_hash !== serverState?.current_lineage?.director_profile_hash
        || plan.effective_style_hash !== serverState?.current_lineage?.effective_style_hash
    ));
    const draftStale = Boolean(serverState?.draft_stale || localPlanStale);
    const currentStale = Boolean(serverState?.current_stale);
    const stale = draftStale || currentStale;
    const shotsByScene = scenes.map(scene => scene.beats.reduce((total, beat) => total + beat.shots.length, 0));
    const durationByScene = scenes.map(scene => scene.beats.reduce(
        (sceneTotal, beat) => sceneTotal + beat.shots.reduce((beatTotal, shot) => beatTotal + (shot.duration_seconds ?? 0), 0),
        0,
    ));

    return (
        <section className="space-y-5" aria-labelledby="director-shooting-plan-title">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                    <div className="flex items-center gap-2">
                        <Clapperboard size={18} className="text-primary" aria-hidden="true" />
                        <h2 id="director-shooting-plan-title" className="text-lg font-semibold text-foreground">{t("title")}</h2>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-text-secondary">{t("hint")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={generate}
                        disabled={locked || dirty || Boolean(serverState?.readiness_error)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {action === "generate" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                        {plan ? t("regenerate") : t("generate")}
                    </button>
                    <button
                        type="button"
                        onClick={() => serverState?.current_lineage && createBlank()}
                        disabled={locked || dirty || Boolean(serverState?.readiness_error)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Plus size={16} aria-hidden="true" />{t("blankPlan")}
                    </button>
                </div>
            </header>

            {action === "load" && <p className="flex items-center gap-2 text-sm text-text-secondary" role="status"><Loader2 size={15} className="animate-spin" aria-hidden="true" />{t("loading")}</p>}
            {error && <div className="flex items-start gap-2 rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</div>}
            {notice && <div className="flex items-start gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{notice}</div>}
            {serverState?.readiness_error && (
                <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" role="status">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{t("notReady", { reason: serverState.readiness_error })}</span>
                </div>
            )}
            {stale && !serverState?.readiness_error && (
                <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" role="status">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{t(draftStale ? "stale" : "confirmedStale")}
                </div>
            )}
            {action === "generate" && (
                <div className="rounded-md border border-border bg-background/50 p-3 text-sm text-text-secondary" role="status" aria-live="polite">
                    <div className="flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" />{t("jobStatus", { status: jobStatus || "running" })}</div>
                    {jobProgress && <p className="mt-1 pl-6 text-xs">{t("progress", jobProgress)}</p>}
                </div>
            )}

            {plan && (
                <>
                    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("summaryTitle")}>
                        {[
                            [t("sceneCount"), scenes.length],
                            [t("beatCount"), beats.length],
                            [t("shotCount"), shots.length],
                            [t("totalDuration"), t("seconds", { value: duration })],
                        ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-md border border-border bg-background/50 p-3">
                                <p className="text-xs text-text-muted">{label}</p>
                                <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
                            </div>
                        ))}
                    </section>

                    <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-plan-timeline-title">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h3 id="director-plan-timeline-title" className="text-sm font-semibold text-foreground">{t("timelineTitle")}</h3>
                                <p className="mt-1 text-xs text-text-muted">{t("timelineHint")}</p>
                            </div>
                            <span className="inline-flex items-center gap-1 text-xs text-text-secondary"><Clock3 size={14} aria-hidden="true" />{t("seconds", { value: duration })}</span>
                        </div>
                        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            {scenes.map((scene, index) => {
                                const percent = duration > 0 ? Math.round(durationByScene[index] / duration * 100) : 0;
                                return (
                                    <li key={scene.scene_id} className="min-w-0 rounded-md border border-border bg-surface p-3">
                                        <p className="truncate text-xs font-semibold text-text-muted">{t("sceneNumber", { number: index + 1 })}</p>
                                        <p className="mt-1 truncate text-sm font-medium text-foreground">{scene.scene_ref || t("unnamedScene")}</p>
                                        <p className="mt-1 text-xs text-text-secondary">{t("sceneTimelineCounts", { beats: scene.beats.length, shots: shotsByScene[index], duration: durationByScene[index] })}</p>
                                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background" aria-label={t("sceneTimelineDuration", { percent })}>
                                            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    </section>

                    <div className="space-y-4">
                        {scenes.map((scene, sceneIndex) => (
                            <section key={scene.scene_id} className="overflow-hidden rounded-lg border border-border bg-background/30" aria-labelledby={`director-plan-scene-${scene.scene_id}`}>
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/60 px-4 py-3">
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t("sceneNumber", { number: sceneIndex + 1 })}</p>
                                        <h3 id={`director-plan-scene-${scene.scene_id}`} className="mt-1 truncate text-base font-semibold text-foreground">{scene.scene_ref || t("unnamedScene")}</h3>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button type="button" onClick={() => updatePlan(current => ({ ...current, scenes: reindex(moveItem(current.scenes, sceneIndex, -1)) }))} disabled={locked || sceneIndex === 0} aria-label={t("moveSceneUp", { number: sceneIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronUp size={16} aria-hidden="true" /></button>
                                        <button type="button" onClick={() => updatePlan(current => ({ ...current, scenes: reindex(moveItem(current.scenes, sceneIndex, 1)) }))} disabled={locked || sceneIndex === scenes.length - 1} aria-label={t("moveSceneDown", { number: sceneIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronDown size={16} aria-hidden="true" /></button>
                                        <button type="button" onClick={() => updatePlan(current => ({ ...current, scenes: reindex(current.scenes.filter((_, index) => index !== sceneIndex)) }))} disabled={locked || scenes.length <= 1} aria-label={t("deleteScene", { number: sceneIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-red-400/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><Trash2 size={16} aria-hidden="true" /></button>
                                    </div>
                                </div>
                                <div className="space-y-5 p-4">
                                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                        <Field label={t("fields.sceneRef")} value={scene.scene_ref} onChange={value => updateScene(sceneIndex, { scene_ref: value })} />
                                        <Field label={t("fields.heading")} value={scene.heading} onChange={value => updateScene(sceneIndex, { heading: value })} />
                                        <Field label={t("fields.location")} value={scene.location} onChange={value => updateScene(sceneIndex, { location: value })} />
                                        <Field label={t("fields.timeAnchor")} value={scene.time_anchor} onChange={value => updateScene(sceneIndex, { time_anchor: value })} />
                                        <Field label={t("fields.sceneDuration")} type="number" min={1} max={1800} value={scene.duration_seconds} onChange={value => updateScene(sceneIndex, { duration_seconds: value ? Number(value) : null })} />
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Field label={t("fields.continuityIn")} value={scene.continuity_in} multiline onChange={value => updateScene(sceneIndex, { continuity_in: value })} />
                                        <Field label={t("fields.continuityOut")} value={scene.continuity_out} multiline onChange={value => updateScene(sceneIndex, { continuity_out: value })} />
                                    </div>
                                    <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                                        <input type="checkbox" checked={scene.continues_previous_scene} onChange={event => updateScene(sceneIndex, { continues_previous_scene: event.target.checked })} className="accent-primary" />
                                        {t("fields.continuesPreviousScene")}
                                    </label>
                                    <Field label={t("fields.environmentAtmosphere")} value={scene.environment_atmosphere} multiline onChange={value => updateScene(sceneIndex, { environment_atmosphere: value })} />
                                    <div className="grid gap-4 lg:grid-cols-2">
                                        <MultiSelect label={t("fields.sceneProps")} values={scene.prop_ids} options={propOptions} onChange={values => updateScene(sceneIndex, { prop_ids: values })} />
                                        <fieldset className="min-w-0 rounded-md border border-border p-3">
                                            <legend className="px-1 text-xs font-medium text-text-secondary">{t("fields.sourceChunks")}</legend>
                                            <p className="mb-2 text-xs leading-5 text-text-muted">{t("sourceChunkCaveat")}</p>
                                            <ul className="mb-2 flex flex-wrap gap-2">
                                                {scene.source_chunk_refs.map(sourceRef => {
                                                    const index = serverState?.source_chunks.findIndex(chunk => chunk.source_ref === sourceRef) ?? -1;
                                                    const chunk = index >= 0 ? serverState?.source_chunks[index] : undefined;
                                                    return (
                                                        <li key={sourceRef} className="rounded border border-border bg-background/50 px-2 py-1 text-xs text-text-secondary">
                                                            {chunk ? t("sourceBlock", { number: index + 1, start: chunk.char_start, end: chunk.char_end }) : sourceRef}
                                                        </li>
                                                    );
                                                })}
                                                {scene.source_chunk_refs.length === 0 && <li className="text-xs text-text-muted">{t("noLinkedSourceChunks")}</li>}
                                            </ul>
                                            <button
                                                type="button"
                                                aria-expanded={sourceEditorSceneId === scene.scene_id}
                                                aria-controls={`director-plan-source-options-${scene.scene_id}`}
                                                onClick={() => setSourceEditorSceneId(current => current === scene.scene_id ? null : scene.scene_id)}
                                                className="min-h-9 rounded border border-border px-3 text-xs text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                            >
                                                {sourceEditorSceneId === scene.scene_id ? t("closeSourceChunks") : t("editSourceChunks", { count: serverState?.source_chunks.length ?? 0 })}
                                            </button>
                                            <div
                                                id={`director-plan-source-options-${scene.scene_id}`}
                                                hidden={sourceEditorSceneId !== scene.scene_id}
                                                className="mt-3 grid max-h-56 gap-2 overflow-y-auto rounded-md border border-border bg-background/40 p-2 sm:grid-cols-2"
                                            >
                                                {sourceEditorSceneId === scene.scene_id && (serverState?.source_chunks ?? []).map((chunk, chunkIndex) => (
                                                        <label key={chunk.source_ref} className="flex min-h-10 items-start gap-2 rounded border border-border px-2 py-2 text-xs text-text-secondary">
                                                            <input
                                                                type="checkbox"
                                                                checked={scene.source_chunk_refs.includes(chunk.source_ref)}
                                                                onChange={event => updateScene(sceneIndex, {
                                                                    source_chunk_refs: event.target.checked
                                                                        ? [...scene.source_chunk_refs, chunk.source_ref]
                                                                        : scene.source_chunk_refs.filter(ref => ref !== chunk.source_ref),
                                                                })}
                                                                className="mt-0.5 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                                            />
                                                            <span>{t("sourceBlock", { number: chunkIndex + 1, start: chunk.char_start, end: chunk.char_end })}</span>
                                                        </label>
                                                    ))}
                                            </div>
                                        </fieldset>
                                    </div>
                                    <div className="space-y-4 border-l-2 border-primary/40 pl-3 sm:pl-5">
                                        {scene.beats.map((beat, beatIndex) => (
                                            <article key={beat.beat_id} className="rounded-md border border-border bg-background/55 p-3 sm:p-4">
                                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                                    <h4 className="text-sm font-semibold text-foreground">{t("beatNumber", { number: beatIndex + 1 })}</h4>
                                                    <div className="flex items-center gap-1">
                                                        <button type="button" onClick={() => updateScene(sceneIndex, { beats: reindex(moveItem(scene.beats, beatIndex, -1)) })} disabled={locked || beatIndex === 0} aria-label={t("moveBeatUp", { number: beatIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronUp size={15} aria-hidden="true" /></button>
                                                        <button type="button" onClick={() => updateScene(sceneIndex, { beats: reindex(moveItem(scene.beats, beatIndex, 1)) })} disabled={locked || beatIndex === scene.beats.length - 1} aria-label={t("moveBeatDown", { number: beatIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronDown size={15} aria-hidden="true" /></button>
                                                        <button type="button" onClick={() => updateScene(sceneIndex, { beats: reindex(scene.beats.filter((_, index) => index !== beatIndex)) })} disabled={locked || scene.beats.length <= 1} aria-label={t("deleteBeat", { number: beatIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-red-400/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><Trash2 size={15} aria-hidden="true" /></button>
                                                    </div>
                                                </div>
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <Field label={t("fields.beatTitle")} value={beat.title} onChange={value => updateBeat(sceneIndex, beatIndex, { title: value })} />
                                                    <Field label={t("fields.emotionalChange")} value={beat.emotional_change} onChange={value => updateBeat(sceneIndex, beatIndex, { emotional_change: value })} />
                                                    <Field label={t("fields.beatDuration")} type="number" min={1} max={300} value={beat.duration_seconds} onChange={value => updateBeat(sceneIndex, beatIndex, { duration_seconds: value ? Number(value) : null })} />
                                                    <label className="inline-flex items-center gap-2 self-end pb-2 text-xs text-text-secondary"><input type="checkbox" checked={beat.keep_with_next} onChange={event => updateBeat(sceneIndex, beatIndex, { keep_with_next: event.target.checked })} className="accent-primary" />{t("fields.keepWithNext")}</label>
                                                    <div className="sm:col-span-2"><Field label={t("fields.dramaticPurpose")} value={beat.dramatic_purpose} multiline onChange={value => updateBeat(sceneIndex, beatIndex, { dramatic_purpose: value })} /></div>
                                                    <div className="sm:col-span-2"><MultiSelect label={t("fields.storyEvents")} values={beat.story_event_ids} options={storyEventOptions} onChange={values => updateBeat(sceneIndex, beatIndex, { story_event_ids: values })} /></div>
                                                </div>
                                                <div className="mt-4 space-y-2">
                                                    {beat.shots.map((shot, shotIndex) => (
                                                        <details
                                                            key={shot.shot_id}
                                                            className="group rounded-md border border-border bg-surface"
                                                            onToggle={event => {
                                                                const isOpen = event.currentTarget.open;
                                                                setExpandedShots(previous => {
                                                                    const next = new Set(previous);
                                                                    if (isOpen) next.add(shot.shot_id);
                                                                    else next.delete(shot.shot_id);
                                                                    return next;
                                                                });
                                                            }}
                                                        >
                                                            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                                                                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                                                                    {t("shotSummary", { number: shotIndex + 1, title: shot.title || t("untitledShot"), size: shot.shot_size || t("unspecified") })}
                                                                </span>
                                                                <span className="shrink-0 rounded-full border border-border px-2 py-1 text-xs text-text-secondary">{t("seconds", { value: shot.duration_seconds ?? 0 })}</span>
                                                            </summary>
                                                            {expandedShots.has(shot.shot_id) && <div className="space-y-4 border-t border-border p-3 sm:p-4">
                                                                <div className="flex justify-end gap-1">
                                                                    <button type="button" onClick={() => updateBeat(sceneIndex, beatIndex, { shots: reindex(moveItem(beat.shots, shotIndex, -1)) })} disabled={locked || shotIndex === 0} aria-label={t("moveShotUp", { number: shotIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronUp size={15} aria-hidden="true" /></button>
                                                                    <button type="button" onClick={() => updateBeat(sceneIndex, beatIndex, { shots: reindex(moveItem(beat.shots, shotIndex, 1)) })} disabled={locked || shotIndex === beat.shots.length - 1} aria-label={t("moveShotDown", { number: shotIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronDown size={15} aria-hidden="true" /></button>
                                                                    <button type="button" onClick={() => updateBeat(sceneIndex, beatIndex, { shots: reindex(beat.shots.filter((_, index) => index !== shotIndex)) })} disabled={locked || beat.shots.length <= 1} aria-label={t("deleteShot", { number: shotIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-red-400/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><Trash2 size={15} aria-hidden="true" /></button>
                                                                </div>
                                                                <div className="grid gap-3 sm:grid-cols-2">
                                                                    <Field label={t("fields.shotTitle")} value={shot.title} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { title: value })} />
                                                                    <Field label={t("fields.duration")} type="number" min={1} max={30} value={shot.duration_seconds} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { duration_seconds: value ? Number(value) : null })} />
                                                                    <div className="sm:col-span-2"><Field label={t("fields.visualIntent")} value={shot.visual_intent} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { visual_intent: value })} /></div>
                                                                    <Field label={t("fields.performanceAction")} value={shot.performance_action} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { performance_action: value })} />
                                                                    <Field label={t("fields.actionPhysics")} value={shot.action_physics} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { action_physics: value })} />
                                                                    <Field label={t("fields.shotSize")} value={shot.shot_size} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { shot_size: value })} />
                                                                    <Field label={t("fields.cameraAngle")} value={shot.camera_angle} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { camera_angle: value })} />
                                                                    <div className="sm:col-span-2"><Field label={t("fields.composition")} value={shot.composition} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { composition: value })} /></div>
                                                                    <Field label={t("fields.cameraMovement")} value={shot.camera_movement} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { camera_movement: value })} />
                                                                    <Field label={t("fields.ambientSound")} value={shot.ambient_sound} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { ambient_sound: value })} />
                                                                </div>
                                                                <fieldset className="rounded-md border border-border p-3">
                                                                    <legend className="px-1 text-xs font-medium text-text-secondary">{t("fields.lighting")}</legend>
                                                                    <div className="grid gap-3 sm:grid-cols-3">
                                                                        <Field label={t("fields.keySource")} value={shot.lighting.key_source} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { lighting: { ...shot.lighting, key_source: value } })} />
                                                                        <Field label={t("fields.colorTone")} value={shot.lighting.color_tone} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { lighting: { ...shot.lighting, color_tone: value } })} />
                                                                        <Field label={t("fields.contrast")} value={shot.lighting.contrast} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { lighting: { ...shot.lighting, contrast: value } })} />
                                                                        <div className="sm:col-span-3"><Field label={t("fields.practicalSources")} value={shot.lighting.practical_sources.join("\n")} multiline hint={t("practicalSourceHint")} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { lighting: { ...shot.lighting, practical_sources: value.split("\n").map(item => item.trim()).filter(Boolean) } })} /></div>
                                                                    </div>
                                                                </fieldset>
                                                                <div className="grid gap-3 lg:grid-cols-2">
                                                                    <MultiSelect label={t("fields.characters")} values={shot.character_ids} options={characterOptions} onChange={values => updateShot(sceneIndex, beatIndex, shotIndex, { character_ids: values })} />
                                                                    <MultiSelect label={t("fields.shotProps")} values={shot.prop_ids} options={propOptions} onChange={values => updateShot(sceneIndex, beatIndex, shotIndex, { prop_ids: values })} />
                                                                </div>
                                                                <fieldset className="space-y-2 rounded-md border border-border p-3">
                                                                    <legend className="px-1 text-xs font-medium text-text-secondary">{t("fields.dialogue")}</legend>
                                                                    {shot.dialogue.map((line: DirectorPlanDialogueLine, lineIndex) => (
                                                                        <div key={`${shot.shot_id}-line-${lineIndex}`} className="grid gap-2 sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)_auto]">
                                                                            <input aria-label={t("fields.speaker")} value={line.speaker} onChange={event => updateShot(sceneIndex, beatIndex, shotIndex, { dialogue: shot.dialogue.map((item, index) => index === lineIndex ? { ...item, speaker: event.target.value } : item) })} className="min-h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
                                                                            <input aria-label={t("fields.dialogueLine")} value={line.line} onChange={event => updateShot(sceneIndex, beatIndex, shotIndex, { dialogue: shot.dialogue.map((item, index) => index === lineIndex ? { ...item, line: event.target.value } : item) })} className="min-h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
                                                                            <button type="button" onClick={() => updateShot(sceneIndex, beatIndex, shotIndex, { dialogue: shot.dialogue.filter((_, index) => index !== lineIndex) })} aria-label={t("deleteDialogue", { number: lineIndex + 1 })} className="min-h-10 rounded-md border border-border px-3 text-text-secondary hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Trash2 size={15} aria-hidden="true" /></button>
                                                                        </div>
                                                                    ))}
                                                                    <button type="button" onClick={() => updateShot(sceneIndex, beatIndex, shotIndex, { dialogue: [...shot.dialogue, { speaker: "", line: "" }] })} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus size={14} aria-hidden="true" />{t("addDialogue")}</button>
                                                                </fieldset>
                                                            </div>}
                                                        </details>
                                                    ))}
                                                    <button type="button" onClick={() => updateBeat(sceneIndex, beatIndex, { shots: [...beat.shots, emptyShot(beat.shots.length)] })} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-text-secondary hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus size={15} aria-hidden="true" />{t("addShot")}</button>
                                                </div>
                                            </article>
                                        ))}
                                        <button type="button" onClick={() => updateScene(sceneIndex, { beats: [...scene.beats, emptyBeat(scene.beats.length)] })} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-text-secondary hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus size={15} aria-hidden="true" />{t("addBeat")}</button>
                                    </div>
                                </div>
                            </section>
                        ))}
                        <button type="button" onClick={() => updatePlan(current => ({ ...current, scenes: [...current.scenes, emptyScene(current.scenes.length)] }))} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-dashed border-border px-4 text-sm text-text-secondary hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus size={16} aria-hidden="true" />{t("addScene")}</button>
                    </div>

                    <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                            {dirty ? <AlertCircle size={16} className="text-amber-300" aria-hidden="true" /> : <Check size={16} className="text-emerald-300" aria-hidden="true" />}
                            <span>{dirty ? t("unsaved") : t("savedDraft", { revision: serverState?.draft_revision ?? 0 })}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {dirty && <button type="button" onClick={() => { setPlan(savedPlan); setNotice(""); }} disabled={locked} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"><RotateCcw size={15} aria-hidden="true" />{t("discardChanges")}</button>}
                            <button type="button" onClick={save} disabled={locked || !dirty || !plan} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"><Save size={15} aria-hidden="true" />{action === "save" ? t("saving") : t("saveDraft")}</button>
                            <button type="button" onClick={confirmPlan} disabled={locked || dirty || !plan || draftStale || Boolean(serverState?.readiness_error)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 size={15} aria-hidden="true" />{action === "confirm" ? t("confirming") : t("confirmPlan")}</button>
                        </div>
                    </div>
                </>
            )}

            {!plan && !serverState?.readiness_error && serverState && (
                <div className="rounded-lg border border-dashed border-border p-5 text-sm text-text-secondary">
                    <p className="font-medium text-foreground">{t("emptyTitle")}</p>
                    <p className="mt-1 leading-6">{t("emptyHint")}</p>
                </div>
            )}

            {history.length > 0 && (
                <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-plan-history-title">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 id="director-plan-history-title" className="text-sm font-semibold text-foreground">{t("historyTitle")}</h3>
                            <p className="mt-1 text-xs text-text-muted">{t("historyHint")}</p>
                        </div>
                        <span className="rounded-full border border-border px-2 py-1 text-xs text-text-secondary">{t("currentVersion", { revision: serverState?.current_revision ?? 0 })}</span>
                    </div>
                    <ol className="space-y-2">
                        {history.map(item => {
                            const lineage = serverState?.current_lineage;
                            const isStale = !lineage
                                || item.source_revision !== lineage.source_revision
                                || item.source_revision_id !== lineage.source_revision_id
                                || item.director_profile_revision !== lineage.director_profile_revision
                                || item.director_profile_hash !== lineage.director_profile_hash
                                || item.effective_style_hash !== lineage.effective_style_hash;
                            return (
                                <li key={item.revision} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-foreground">{t("historyItem", { revision: item.revision, scenes: item.scene_count, shots: item.shot_count, duration: item.duration_seconds })}</p>
                                        <p className="mt-1 text-xs text-text-muted">{new Date(item.confirmed_at * 1000).toLocaleString()}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isStale && <span className="rounded-full border border-amber-400/30 px-2 py-1 text-xs text-amber-200">{t("staleBadge")}</span>}
                                        <button type="button" onClick={() => restore(item.revision)} disabled={locked || dirty || isStale} className="min-h-9 rounded-md border border-border px-3 text-xs text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50">{action === "restore" ? t("restoring") : t("restoreRevision")}</button>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                </section>
            )}

            <details className="rounded-lg border border-border bg-background/30 p-4">
                <summary className="cursor-pointer text-sm font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t("referenceTitle")}</summary>
                <p className="mt-2 text-xs leading-5 text-text-muted">{t("referenceHint")}</p>
                <div className="mt-3 space-y-2">
                    {examples.map((example, index) => (
                        <article key={`sample-plan-${index}`} className="rounded-md border border-border bg-surface p-3">
                            <h4 className="text-sm font-medium text-foreground">{String(example.range ?? t("exampleNumber", { number: index + 1 }))}</h4>
                            <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                                {(["purpose", "focus", "asset_need"] as const).map(field => example[field] !== undefined && (
                                    <div key={field}>
                                        <dt className="text-xs font-medium text-text-muted">{t(`fields.${field}`)}</dt>
                                        <dd className="mt-1 whitespace-pre-wrap text-sm leading-5 text-text-secondary">{String(example[field])}</dd>
                                    </div>
                                ))}
                            </dl>
                        </article>
                    ))}
                    {examples.length === 0 && <p className="rounded-md border border-dashed border-border p-3 text-sm text-text-muted">{t("noExamples")}</p>}
                </div>
            </details>
        </section>
    );
}
