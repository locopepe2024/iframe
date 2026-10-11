"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    Check,
    CheckCircle2,
    Clapperboard,
    ChevronDown,
    ChevronUp,
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
    DirectorPlanCastBinding,
    DirectorPlanDialogueLine,
    DirectorPlanLightingBaseline,
    DirectorPlanScene,
    DirectorPlanShot,
    DirectorShootingPlan,
    DirectorShootingPlanRevisionSummary,
    DirectorShootingPlanState,
} from "@/lib/directorShootingPlan";
import { useProjectStore, type DirectorProfile } from "@/store/projectStore";
import { extractErrorDetail } from "@/lib/utils";
import { planLightingConflicts } from "@/lib/directorPlanLighting";

type Action = "load" | "generate" | "save" | "confirm" | "restore" | null;

const emptyLighting = () => ({ key_source: "", color_tone: "", contrast: "", practical_sources: [] as string[] });
const newId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const planFingerprint = (plan: DirectorShootingPlan | null) => plan ? JSON.stringify(plan) : "";

function emptyShot(order: number): DirectorPlanShot {
    return {
        shot_id: newId("plan-shot"), order, title: "", visual_intent: "", director_effect: "", performance_action: "",
        action_physics: "", shot_size: "", camera_angle: "", composition: "", camera_movement: "",
        lighting: emptyLighting(), lighting_override_reason: "", duration_seconds: 3, dialogue: [], ambient_sound: "",
        character_ids: [], prop_ids: [],
        cast_bindings: [], scene_binding: null, prop_bindings: [],
    };
}

function castBindingsText(bindings: DirectorPlanCastBinding[]): string {
    return bindings.map(binding => [binding.person_id, binding.era_variant_id || "", binding.scene_look_id || ""].join("|")).join("\n");
}

function parseCastBindings(value: string): DirectorPlanCastBinding[] {
    return value.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
        const [person_id, era_variant_id, scene_look_id] = line.split("|").map(item => item.trim());
        return {
            person_id,
            era_variant_id: era_variant_id || null,
            scene_look_id: scene_look_id || null,
            continuity_state: {},
            binding_status: "selected" as const,
        };
    }).filter(binding => binding.person_id);
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
        place_continuity_id: null, time_continuity_id: null,
        continues_previous_scene: false, continuity_in: "", continuity_out: "", duration_seconds: null,
        environment_atmosphere: "", unresolved_questions: [], source_chunk_refs: [], prop_ids: [],
        beats: [emptyBeat(0)],
    };
}

function stableLineageChanged(plan: DirectorShootingPlan | null, lineage: Record<string, unknown> | null | undefined): boolean {
    return Boolean(plan && (!lineage || plan.source_revision !== lineage.source_revision
        || plan.source_revision_id !== lineage.source_revision_id
        || plan.director_profile_revision !== lineage.director_profile_revision
        || plan.director_profile_hash !== lineage.director_profile_hash));
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
    placeholder,
}: {
    label: string;
    value: string | number | null;
    onChange: (value: string) => void;
    multiline?: boolean;
    type?: string;
    min?: number;
    max?: number;
    hint?: string;
    placeholder?: string;
}) {
    const id = useId();
    return (
        <div className="min-w-0">
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-text-secondary">{label}</label>
            {multiline ? (
                <textarea
                    id={id}
                    value={value ?? ""}
                    placeholder={placeholder}
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
                    placeholder={placeholder}
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

export default function DirectorShootingPlanPanel({ selectedDirector = null, historical = false }: { selectedDirector?: DirectorProfile | null; historical?: boolean }) {
    const t = useTranslations("artDirection.directorPlan");
    const { currentProject } = useProjectStore();
    const projectId = currentProject?.id;
    const confirmedProfile = currentProject?.art_direction?.director_profile;
    const viewedDirector = selectedDirector ?? confirmedProfile;
    const examples = Array.isArray(confirmedProfile?.sample_plan)
        ? confirmedProfile.sample_plan.filter(value => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown>[]
        : [];

    const [serverState, setServerState] = useState<DirectorShootingPlanState | null>(null);
    const [plan, setPlan] = useState<DirectorShootingPlan | null>(null);
    const [savedPlan, setSavedPlan] = useState<DirectorShootingPlan | null>(null);
    const [history, setHistory] = useState<DirectorShootingPlanRevisionSummary[]>([]);
    const [selectedPlanRevision, setSelectedPlanRevision] = useState<number | null>(null);
    const [previewPlan, setPreviewPlan] = useState<DirectorShootingPlan | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [action, setAction] = useState<Action>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [jobProgress, setJobProgress] = useState<{ completed: number; total: number } | null>(null);
    const [jobStatus, setJobStatus] = useState("");
    const [expandedShots, setExpandedShots] = useState<Set<string>>(() => new Set());
    const [expandedShotContextIds, setExpandedShotContextIds] = useState<Set<string>>(() => new Set());
    const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(() => new Set());
    const [expandedSceneContextIds, setExpandedSceneContextIds] = useState<Set<string>>(() => new Set());
    const [sourceEditorSceneId, setSourceEditorSceneId] = useState<string | null>(null);
    const [revisionTitle, setRevisionTitle] = useState("");
    const [revisionSummary, setRevisionSummary] = useState("");

    const sourceRevision = currentProject?.source_revision ?? 1;
    const currentLineage = serverState?.current_lineage;
    const draftStale = Boolean(serverState?.draft_stale || stableLineageChanged(plan, currentLineage));
    const storyEventOptions = serverState?.current_story_events ?? [];
    const knownStoryEventIds = new Set(storyEventOptions.map(event => event.id));
    const unknownStoryEventIds = Array.from(new Set((plan?.scenes ?? []).flatMap(scene =>
        scene.beats.flatMap(beat => beat.story_event_ids.filter(id => !knownStoryEventIds.has(id))),
    )));
    const dirty = useMemo(() => planFingerprint(plan) !== planFingerprint(savedPlan), [plan, savedPlan]);
    const scenes = plan?.scenes ?? [];
    const beats = scenes.flatMap(scene => scene.beats);
    const shots = beats.flatMap(beat => beat.shots);
    const duration = shots.reduce((total, shot) => total + (shot.duration_seconds ?? 0), 0);
    const lightingConflicts = planLightingConflicts(plan);
    const viewedDirectorRevision = viewedDirector?.revision ?? Number(currentLineage?.director_profile_revision ?? 0);
    const viewedDirectorHash = viewedDirector?.content_hash ?? String(currentLineage?.director_profile_hash ?? "");
    const matchingHistory = history.filter(item => item.director_profile_revision === viewedDirectorRevision
        && item.director_profile_hash === viewedDirectorHash).sort((a, b) => b.revision - a.revision);
    const selectedSummary = matchingHistory.find(item => item.revision === selectedPlanRevision) ?? matchingHistory[0];
    const editableForSelection = !historical && Boolean(plan && currentLineage
        && plan.director_profile_revision === viewedDirectorRevision
        && plan.director_profile_hash === viewedDirectorHash
        && !stableLineageChanged(plan, currentLineage));

    useEffect(() => {
        setSelectedPlanRevision(null);
    }, [projectId, viewedDirector?.revision, viewedDirector?.content_hash]);

    useEffect(() => {
        if (!projectId || !selectedSummary || (editableForSelection && !historical)) {
            setPreviewPlan(null);
            setPreviewLoading(false);
            return;
        }
        let active = true;
        setPreviewPlan(null);
        setPreviewLoading(true);
        api.getDirectorShootingPlanRevision(projectId, selectedSummary.revision)
            .then(result => { if (active) setPreviewPlan(result.plan); })
            .catch(() => { if (active) setPreviewPlan(null); })
            .finally(() => { if (active) setPreviewLoading(false); });
        return () => { active = false; };
    }, [projectId, selectedSummary?.revision, editableForSelection, historical]);
    const localDirtyRef = useRef(dirty);
    localDirtyRef.current = dirty;
    const activeProjectId = useRef<string | undefined>(projectId);
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
                setExpandedShotContextIds(new Set());
                setExpandedSceneIds(new Set((nextState.draft?.scenes ?? []).map(scene => scene.scene_id)));
                setExpandedSceneContextIds(new Set());
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
            setExpandedShotContextIds(new Set());
            setExpandedSceneIds(new Set());
            setExpandedSceneContextIds(new Set());
            setSourceEditorSceneId(null);
            setError("");
            setNotice("");
        }
        void load(!changedProject);
    }, [load, sourceRevision, confirmedProfile?.revision, confirmedProfile?.content_hash]);

    const updatePlan = (update: (current: DirectorShootingPlan) => DirectorShootingPlan) => {
        setPlan(current => current ? update(current) : current);
        setNotice("");
    };

    const updateScene = (sceneIndex: number, patch: Partial<DirectorPlanScene>) => updatePlan(current => ({
        ...current,
        scenes: current.scenes.map((scene, index) => index === sceneIndex ? { ...scene, ...patch } : scene),
    }));

    const addLightingBaseline = (placeId: string, timeId: string) => updatePlan(current => ({
        ...current,
        lighting_baselines: [...(current.lighting_baselines ?? []), {
            place_continuity_id: placeId,
            time_continuity_id: timeId,
            story_time: "", daylight_phase: "", weather: "", shadow_direction: "",
            lighting: emptyLighting(),
        }],
    }));

    const updateLightingBaseline = (placeId: string, timeId: string, patch: Partial<DirectorPlanLightingBaseline>) => updatePlan(current => ({
        ...current,
        lighting_baselines: (current.lighting_baselines ?? []).map(item =>
            item.place_continuity_id === placeId && item.time_continuity_id === timeId
                ? { ...item, ...patch } : item),
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
            setExpandedShots(new Set());
            setExpandedSceneIds(new Set(generated.scenes.map(scene => scene.scene_id)));
            setExpandedSceneContextIds(new Set());
            setExpandedShotContextIds(new Set());
            setNotice(serverState?.draft
                ? t("generatedReplacing", { revision: generated.director_profile_revision, draft: serverState.draft_revision })
                : t("generated", { revision: generated.director_profile_revision }));
            setServerState(previous => previous ? { ...previous, draft_stale: false } : previous);
        } catch (cause) {
            setError(extractErrorDetail(cause) || t("generateFailed"));
        } finally {
            setAction(null);
            setJobStatus("");
        }
    };

    const save = async () => {
        if (!projectId || !plan) return;
        setAction("save");
        setError("");
        try {
            const allowStaleLineage = draftStale || Boolean(serverState?.readiness_error);
            const result = allowStaleLineage
                ? await api.saveDirectorShootingPlanDraft(projectId, sourceRevision, serverState?.draft_revision ?? 0, plan, true)
                : await api.saveDirectorShootingPlanDraft(projectId, sourceRevision, serverState?.draft_revision ?? 0, plan);
            setPlan(result.draft);
            setSavedPlan(result.draft);
            setExpandedShots(new Set());
            setExpandedSceneIds(new Set((result.draft?.scenes ?? []).map(scene => scene.scene_id)));
            setServerState(previous => previous ? {
                ...previous,
                draft: result.draft,
                draft_revision: result.draft_revision,
                draft_updated_at: result.draft_updated_at,
                draft_stale: stableLineageChanged(result.draft, previous.current_lineage),
            } : previous);
            setNotice(t("draftSaved", { revision: result.draft_revision }));
        } catch (cause) {
            setError(extractErrorDetail(cause) || t("saveFailed"));
        } finally {
            setAction(null);
        }
    };

    const confirmPlan = async () => {
        if (!projectId || !plan || dirty || draftStale || serverState?.readiness_error) return;
        if (lightingConflicts.length) {
            openLightingConflict(lightingConflicts[0]);
            setError(t("lightingConflictSummary", { count: lightingConflicts.length }));
            return;
        }
        setAction("confirm");
        setError("");
        try {
            const result = await api.confirmDirectorShootingPlan(projectId, serverState?.current_revision ?? 0, serverState?.draft_revision ?? 0, plan, revisionTitle, revisionSummary);
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

    if (!serverState) {
        return <p role="status" className="text-sm text-text-secondary">{error || t("loading")}</p>;
    }

    if (historical || !editableForSelection) {
        return (
            <section className="space-y-5" aria-labelledby="director-shooting-plan-title">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 id="director-shooting-plan-title" className="text-lg font-semibold text-foreground">{t("title")}</h2>
                        <p className="mt-1 text-sm text-text-secondary">{t("selectedSource", { revision: viewedDirectorRevision })}</p>
                    </div>
                    {!historical && <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={generate} disabled={action !== null || dirty || Boolean(serverState?.readiness_error)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-white disabled:opacity-50"><Sparkles size={16} />{t("generate")}</button>
                    </div>}
                </div>
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                {action === "generate" && <p role="status" className="text-sm text-text-secondary">{t("jobStatus", { status: jobStatus || "running" })}</p>}
                {selectedSummary && matchingHistory.length > 1 && (
                    <label className="flex items-center gap-2 text-sm text-text-secondary">
                        {t("planVersion")}
                        <select value={selectedSummary.revision} onChange={event => setSelectedPlanRevision(Number(event.target.value))} className="min-h-10 rounded-md border border-border bg-background px-2 text-foreground">
                            {matchingHistory.map(item => <option key={item.revision} value={item.revision}>v{item.revision}</option>)}
                        </select>
                    </label>
                )}
                {!selectedSummary && <p className="border-y border-border py-5 text-sm text-text-secondary">{t("noPlanForSource", { revision: viewedDirectorRevision })}</p>}
                {(previewLoading || action === "load") && <p role="status" className="text-sm text-text-secondary">{t("loading")}</p>}
                {selectedSummary && !previewLoading && !previewPlan && <p role="alert" className="text-sm text-red-300">{t("loadFailed")}</p>}
                {previewPlan && (
                    <div className="space-y-4">
                        <p className="text-sm font-medium text-foreground">{t("planSourcePair", { plan: selectedSummary.revision, director: previewPlan.director_profile_revision })}</p>
                        <ol className="divide-y divide-border border-y border-border">
                            {previewPlan.scenes.map(scene => <li key={scene.scene_id} className="py-3">
                                <p className="font-medium text-foreground">{scene.heading || scene.scene_id}</p>
                                <p className="mt-1 text-xs text-text-secondary">{scene.location} · {scene.time_anchor}</p>
                                <ol className="mt-2 space-y-1 pl-4 text-sm text-text-secondary">
                                    {scene.beats.map(beat => <li key={beat.beat_id}>
                                        <p>{beat.title || beat.beat_id}</p>
                                        <ol className="mt-1 space-y-1 pl-4 text-xs">
                                            {beat.shots.map(shot => <li key={shot.shot_id}>{shot.title || shot.shot_id} · {shot.shot_size} · {shot.performance_action}</li>)}
                                        </ol>
                                    </li>)}
                                </ol>
                            </li>)}
                        </ol>
                    </div>
                )}
            </section>
        );
    }

    const locked = action !== null;
    const showLineageNotice = Boolean(plan && (draftStale || serverState?.readiness_error));
    const staleReferences = (draftStale ? [plan] : [])
        .filter((item): item is NonNullable<typeof plan> => Boolean(item));
    const staleChanges = Array.from(new Set(staleReferences.flatMap(reference => [
        serverState?.current_lineage?.source_revision !== undefined && reference.source_revision !== Number(serverState.current_lineage.source_revision) ? t("changedScriptRevision", { from: reference.source_revision, to: Number(serverState.current_lineage.source_revision) }) : null,
        serverState?.current_lineage?.source_revision_id && reference.source_revision_id !== serverState.current_lineage.source_revision_id ? t("changedScriptContent") : null,
        !draftStale && serverState?.current_lineage?.director_profile_revision !== undefined && reference.director_profile_revision !== Number(serverState.current_lineage.director_profile_revision) ? t("changedDirectorRevision", { from: reference.director_profile_revision, to: Number(serverState.current_lineage.director_profile_revision) }) : null,
        !draftStale && serverState?.current_lineage?.director_profile_hash && reference.director_profile_hash !== serverState.current_lineage.director_profile_hash ? t("changedDirectorContent") : null,
    ].filter((item): item is string => Boolean(item)))));
    const openPlanEditor = () => {
        requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("director-plan-editor")?.scrollIntoView({ behavior: "smooth", block: "start" })));
    };
    const openLightingConflict = (conflict: (typeof lightingConflicts)[number]) => {
        setExpandedSceneIds(previous => new Set(previous).add(conflict.sceneId));
        setExpandedSceneContextIds(previous => new Set(previous).add(conflict.sceneId));
        setExpandedShots(previous => new Set(previous).add(conflict.shotId));
        setExpandedShotContextIds(previous => new Set(previous).add(conflict.shotId));
        requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`director-plan-shot-${conflict.shotId}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" })));
    };

    return (
        <section className="space-y-5" aria-labelledby="director-shooting-plan-title">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                    <div className="flex items-center gap-2">
                        <Clapperboard size={18} className="text-primary" aria-hidden="true" />
                        <h2 id="director-shooting-plan-title" className="text-lg font-semibold text-foreground">{t("title")}</h2>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-text-secondary">{t("hint")}</p>
                    {plan && <p className="mt-1 text-xs font-medium text-text-secondary">{t("draftSourcePair", { draft: serverState?.draft_revision ?? 0, director: plan.director_profile_revision })}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={generate}
                        disabled={locked || dirty || Boolean(serverState?.readiness_error)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {action === "generate" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                        {plan ? t("regenerate", { revision: Number(currentLineage?.director_profile_revision ?? 0) }) : t("generate")}
                    </button>
                </div>
            </header>

            {action === "load" && <p className="flex items-center gap-2 text-sm text-text-secondary" role="status"><Loader2 size={15} className="animate-spin" aria-hidden="true" />{t("loading")}</p>}
            {error && <div className="flex items-start gap-2 rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</div>}
            {notice && <div className="flex items-start gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{notice}</div>}
            {lightingConflicts.length > 0 && <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" role="status">
                <p className="font-medium">{t("lightingConflictSummary", { count: lightingConflicts.length })}</p>
                <p className="mt-1 text-xs">{t("lightingConflictHint")}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                    {lightingConflicts.map(conflict => <li key={conflict.shotId}><button type="button" onClick={() => openLightingConflict(conflict)} className="rounded border border-amber-300/40 px-2 py-1 text-xs hover:bg-amber-300/10">{t("lightingConflictShot", { scene: conflict.sceneIndex + 1, shot: conflict.shotTitle || conflict.shotId })}</button></li>)}
                </ul>
            </div>}
            {serverState?.readiness_error && (
                <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" role="status">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{t("notReady", { reason: serverState.readiness_error })}</span>
                </div>
            )}
            {showLineageNotice && (
                <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100" role="status">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                        <span>{serverState?.readiness_error ? t("staleWithReadinessError") : draftStale
                            ? t("draftStale", { draft: serverState?.draft_revision ?? 0, from: plan?.director_profile_revision ?? 0, to: Number(currentLineage?.director_profile_revision ?? 0) })
                            : t("confirmedStale", { revision: serverState?.current_revision ?? 0 })}</span>
                        {plan && !draftStale && <button type="button" onClick={openPlanEditor} className="rounded border border-amber-200/40 px-2 py-1 text-xs font-medium text-amber-50 hover:bg-amber-200/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200">{t("revisePlan")}</button>}
                        {staleChanges.length > 0 && <ul className="basis-full list-disc pl-5 text-xs text-amber-100/90">{staleChanges.map(change => <li key={change}>{change}</li>)}</ul>}
                        {draftStale && unknownStoryEventIds.length > 0 && <span className="basis-full text-xs text-amber-100/90">{t("unknownStoryEvents", { ids: unknownStoryEventIds.join(", ") })}</span>}
                    </span>
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
                    <p className="text-xs text-text-muted" aria-label={t("summaryTitle")}>
                        {t("reviewSummary", { scenes: scenes.length, beats: beats.length, shots: shots.length, duration: t("seconds", { value: duration }) })}
                    </p>

                    <div id="director-plan-editor" className="space-y-4">
                        {scenes.map((scene, sceneIndex) => (
                            <section key={scene.scene_id} className="overflow-hidden rounded-lg border border-border bg-background/30" aria-labelledby={`director-plan-scene-${scene.scene_id}`}>
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/60 px-4 py-3">
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t("sceneNumber", { number: sceneIndex + 1 })}</p>
                                        <h3 id={`director-plan-scene-${scene.scene_id}`} className="mt-1 truncate text-base font-semibold text-foreground">{scene.heading || scene.scene_ref || t("unnamedScene")}</h3>
                                        <p className="mt-1 text-xs text-text-muted">{t("sceneOverview", { beats: scene.beats.length, shots: scene.beats.reduce((total, beat) => total + beat.shots.length, 0), location: scene.location || t("unspecified"), time: scene.time_anchor || t("unspecified") })}</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            aria-expanded={expandedSceneIds.has(scene.scene_id)}
                                            aria-controls={`director-plan-scene-body-${scene.scene_id}`}
                                            onClick={() => setExpandedSceneIds(previous => {
                                                const next = new Set(previous);
                                                if (next.has(scene.scene_id)) next.delete(scene.scene_id);
                                                else next.add(scene.scene_id);
                                                return next;
                                            })}
                                            className="min-h-9 rounded border border-border px-3 text-xs text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                        >
                                            {expandedSceneIds.has(scene.scene_id) ? t("collapseScene") : t("expandScene")}
                                        </button>
                                        <button type="button" onClick={() => updatePlan(current => ({ ...current, scenes: reindex(moveItem(current.scenes, sceneIndex, -1)) }))} disabled={locked || sceneIndex === 0} aria-label={t("moveSceneUp", { number: sceneIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronUp size={16} aria-hidden="true" /></button>
                                        <button type="button" onClick={() => updatePlan(current => ({ ...current, scenes: reindex(moveItem(current.scenes, sceneIndex, 1)) }))} disabled={locked || sceneIndex === scenes.length - 1} aria-label={t("moveSceneDown", { number: sceneIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronDown size={16} aria-hidden="true" /></button>
                                        <button type="button" onClick={() => updatePlan(current => ({ ...current, scenes: reindex(current.scenes.filter((_, index) => index !== sceneIndex)) }))} disabled={locked || scenes.length <= 1} aria-label={t("deleteScene", { number: sceneIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-red-400/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><Trash2 size={16} aria-hidden="true" /></button>
                                    </div>
                                </div>
                                {expandedSceneIds.has(scene.scene_id) && <div id={`director-plan-scene-body-${scene.scene_id}`} className="space-y-5 p-4">
                                    <div className="grid gap-3 rounded-md border border-border bg-background/35 p-3 sm:grid-cols-2">
                                        <div>
                                            <p className="text-xs font-medium text-text-muted">{t("fields.continuityIn")}</p>
                                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{scene.continuity_in || t("continuityUnspecified")}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-text-muted">{t("fields.continuityOut")}</p>
                                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{scene.continuity_out || t("continuityUnspecified")}</p>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <p className="text-xs font-medium text-text-muted">{t("fields.environmentAtmosphere")}</p>
                                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{scene.environment_atmosphere || t("atmosphereUnspecified")}</p>
                                        </div>
                                    </div>
                                    <details className="rounded-md border border-border bg-background/20">
                                        <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-xs font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">{t("editSceneReview")}</summary>
                                        <div className="space-y-4 border-t border-border p-3">
                                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                        <Field label={t("fields.heading")} value={scene.heading} placeholder={t("fields.headingPlaceholder")} hint={t("fields.headingHint")} onChange={value => updateScene(sceneIndex, { heading: value })} />
                                        <Field label={t("fields.location")} value={scene.location} onChange={value => updateScene(sceneIndex, { location: value })} />
                                        <Field label={t("fields.timeAnchor")} value={scene.time_anchor} onChange={value => updateScene(sceneIndex, { time_anchor: value })} />
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
                                        </div>
                                    </details>
                                    <details
                                        open={expandedSceneContextIds.has(scene.scene_id)}
                                        className="rounded-md border border-border bg-background/25"
                                        onToggle={event => {
                                            const isOpen = event.currentTarget.open;
                                            setExpandedSceneContextIds(previous => {
                                                const next = new Set(previous);
                                                if (isOpen) next.add(scene.scene_id);
                                                else next.delete(scene.scene_id);
                                                return next;
                                            });
                                        }}
                                    >
                                        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                                            <span>{t("advancedSceneContextTitle")}</span>
                                            <span className="text-text-muted">{t("advancedSceneContextHint")}</span>
                                        </summary>
                                        <div className="space-y-4 border-t border-border p-3">
                                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                                <Field label={t("fields.sceneRef")} value={scene.scene_ref} onChange={value => updateScene(sceneIndex, { scene_ref: value })} />
                                                <Field label={t("fields.placeContinuityId")} value={scene.place_continuity_id ?? ""} onChange={value => updateScene(sceneIndex, { place_continuity_id: value.trim() || null })} />
                                                <Field label={t("fields.timeContinuityId")} value={scene.time_continuity_id ?? ""} onChange={value => updateScene(sceneIndex, { time_continuity_id: value.trim() || null })} />
                                                <Field label={t("fields.sceneDuration")} type="number" min={1} max={1800} value={scene.duration_seconds} onChange={value => updateScene(sceneIndex, { duration_seconds: value ? Number(value) : null })} />
                                            </div>
                                            {scene.place_continuity_id && scene.time_continuity_id && (() => {
                                        const placeId = scene.place_continuity_id;
                                        const timeId = scene.time_continuity_id;
                                        const baseline = (plan.lighting_baselines ?? []).find(item =>
                                            item.place_continuity_id === placeId && item.time_continuity_id === timeId);
                                        return <fieldset className="border-t border-border pt-3">
                                            <legend className="text-xs font-medium text-text-secondary">{t("fields.continuityBaseline")}</legend>
                                            {!baseline ? <button type="button" onClick={() => addLightingBaseline(placeId, timeId)} disabled={locked}
                                                className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-surface disabled:opacity-50">
                                                <Plus size={13} aria-hidden="true" />{t("fields.addContinuityBaseline")}
                                            </button> : <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                                <Field label={t("fields.storyTime")} value={baseline.story_time} onChange={value => updateLightingBaseline(placeId, timeId, { story_time: value })} />
                                                <Field label={t("fields.daylightPhase")} value={baseline.daylight_phase} onChange={value => updateLightingBaseline(placeId, timeId, { daylight_phase: value })} />
                                                <Field label={t("fields.weather")} value={baseline.weather} onChange={value => updateLightingBaseline(placeId, timeId, { weather: value })} />
                                                <Field label={t("fields.shadowDirection")} value={baseline.shadow_direction} onChange={value => updateLightingBaseline(placeId, timeId, { shadow_direction: value })} />
                                                <Field label={t("fields.keySource")} value={baseline.lighting.key_source} onChange={value => updateLightingBaseline(placeId, timeId, { lighting: { ...baseline.lighting, key_source: value } })} />
                                                <Field label={t("fields.colorTone")} value={baseline.lighting.color_tone} onChange={value => updateLightingBaseline(placeId, timeId, { lighting: { ...baseline.lighting, color_tone: value } })} />
                                                <Field label={t("fields.contrast")} value={baseline.lighting.contrast} onChange={value => updateLightingBaseline(placeId, timeId, { lighting: { ...baseline.lighting, contrast: value } })} />
                                                <Field label={t("fields.practicalSources")} value={baseline.lighting.practical_sources.join("\n")} multiline onChange={value => updateLightingBaseline(placeId, timeId, { lighting: { ...baseline.lighting, practical_sources: value.split("\n").map(item => item.trim()).filter(Boolean) } })} />
                                                <button type="button" onClick={() => updatePlan(current => ({ ...current,
                                                    lighting_baselines: (current.lighting_baselines ?? []).filter(item =>
                                                        item.place_continuity_id !== placeId || item.time_continuity_id !== timeId),
                                                }))} disabled={locked} className="w-fit text-xs text-red-300 hover:underline disabled:opacity-50">{t("fields.removeContinuityBaseline")}</button>
                                                </div>}
                                        </fieldset>;
                                    })()}
                                        </div>
                                    </details>
                                    <details className="rounded-md border border-border bg-background/25">
                                        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                                            <span>{t("sceneAssetsAndSourcesTitle")}</span>
                                            <span className="text-text-muted">{t("sceneAssetsAndSourcesHint")}</span>
                                        </summary>
                                        <div className="grid gap-4 border-t border-border p-3 lg:grid-cols-2">
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
                                    </details>
                                    <div className="space-y-4 border-l-2 border-primary/40 pl-3 sm:pl-5">
                                        {scene.beats.map((beat, beatIndex) => (
                                            <article key={beat.beat_id} className="rounded-md border border-border bg-background/55 p-3 sm:p-4">
                                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <h4 className="text-sm font-semibold text-foreground">{t("beatNumber", { number: beatIndex + 1 })}</h4>
                                                        <p className="mt-1 text-xs text-text-muted">{beat.title || t("untitledBeat")} · {t("beatOverview", { shots: beat.shots.length, purpose: beat.dramatic_purpose || t("unspecified") })}</p>
                                                        {beat.emotional_change && <p className="mt-1 text-sm leading-5 text-text-secondary">{t("beatEmotion")}: {beat.emotional_change}</p>}
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <details className="relative">
                                                            <summary className="flex min-h-9 cursor-pointer list-none items-center rounded border border-border px-3 text-xs text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t("editBeat")}</summary>
                                                            <div id={`director-plan-beat-body-${beat.beat_id}`} className="absolute right-0 z-20 mt-2 grid w-[min(34rem,calc(100vw-3rem))] gap-3 rounded-md border border-border bg-background p-3 shadow-xl sm:grid-cols-2">
                                                                <Field label={t("fields.beatTitle")} value={beat.title} onChange={value => updateBeat(sceneIndex, beatIndex, { title: value })} />
                                                                <Field label={t("fields.emotionalChange")} value={beat.emotional_change} onChange={value => updateBeat(sceneIndex, beatIndex, { emotional_change: value })} />
                                                                <Field label={t("fields.beatDuration")} type="number" min={1} max={300} value={beat.duration_seconds} onChange={value => updateBeat(sceneIndex, beatIndex, { duration_seconds: value ? Number(value) : null })} />
                                                                <label className="inline-flex items-center gap-2 self-end pb-2 text-xs text-text-secondary"><input type="checkbox" checked={beat.keep_with_next} onChange={event => updateBeat(sceneIndex, beatIndex, { keep_with_next: event.target.checked })} className="accent-primary" />{t("fields.keepWithNext")}</label>
                                                                <div className="sm:col-span-2"><Field label={t("fields.dramaticPurpose")} value={beat.dramatic_purpose} multiline onChange={value => updateBeat(sceneIndex, beatIndex, { dramatic_purpose: value })} /></div>
                                                                <div className="sm:col-span-2 space-y-2">
                                                                    <MultiSelect label={t("fields.storyEvents")} values={beat.story_event_ids} options={storyEventOptions} onChange={values => updateBeat(sceneIndex, beatIndex, { story_event_ids: values })} />
                                                                    {beat.story_event_ids.filter(id => !knownStoryEventIds.has(id)).map(id => (
                                                                        <button key={id} type="button" onClick={() => updateBeat(sceneIndex, beatIndex, { story_event_ids: beat.story_event_ids.filter(value => value !== id) })} className="rounded border border-amber-400/40 px-2 py-1 text-xs text-amber-100 hover:bg-amber-400/10" aria-label={t("removeObsoleteEvent", { id })}>
                                                                            {t("removeObsoleteEvent", { id })}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </details>
                                                        <button type="button" onClick={() => updateScene(sceneIndex, { beats: reindex(moveItem(scene.beats, beatIndex, -1)) })} disabled={locked || beatIndex === 0} aria-label={t("moveBeatUp", { number: beatIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronUp size={15} aria-hidden="true" /></button>
                                                        <button type="button" onClick={() => updateScene(sceneIndex, { beats: reindex(moveItem(scene.beats, beatIndex, 1)) })} disabled={locked || beatIndex === scene.beats.length - 1} aria-label={t("moveBeatDown", { number: beatIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronDown size={15} aria-hidden="true" /></button>
                                                        <button type="button" onClick={() => updateScene(sceneIndex, { beats: reindex(scene.beats.filter((_, index) => index !== beatIndex)) })} disabled={locked || scene.beats.length <= 1} aria-label={t("deleteBeat", { number: beatIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-red-400/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><Trash2 size={15} aria-hidden="true" /></button>
                                                    </div>
                                                </div>
                                                <div className="mt-4 space-y-2">
                                                    {beat.shots.map((shot, shotIndex) => (
                                                        <details
                                                            key={shot.shot_id}
                                                            id={`director-plan-shot-${shot.shot_id}`}
                                                            open={expandedShots.has(shot.shot_id)}
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
                                                            <summary className="flex min-h-12 cursor-pointer list-none items-start justify-between gap-3 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                                                                <span className="min-w-0 flex-1">
                                                                    <span className="block truncate text-sm font-medium text-foreground">{t("shotSummary", { number: shotIndex + 1, title: shot.title || t("untitledShot"), size: shot.shot_size || t("unspecified") })}</span>
                                                                    <span className="mt-1 block whitespace-normal text-sm leading-5 text-text-secondary">{shot.visual_intent || t("shotDirectionUnspecified")}</span>
                                                                    {(shot.director_effect || shot.performance_action) && <span className="mt-1 block whitespace-normal text-xs leading-5 text-text-muted">{[shot.director_effect, shot.performance_action].filter(Boolean).join(" · ")}</span>}
                                                                    {shot.action_physics && <span className="mt-1 block whitespace-normal text-xs leading-5 text-text-muted">{t("shotActionSummary")}: {shot.action_physics}</span>}
                                                                    <span className="mt-1 block whitespace-normal text-xs text-text-muted">{[shot.camera_angle, shot.camera_movement].filter(Boolean).join(" · ") || t("shotFramingUnspecified")}</span>
                                                                </span>
                                                                <span className="flex shrink-0 flex-col items-end gap-1">
                                                                    <span className="rounded-full border border-border px-2 py-1 text-xs text-text-secondary">{t("seconds", { value: shot.duration_seconds ?? 0 })}</span>
                                                                    <span className="text-[11px] text-primary">{t("editShotDetails")}</span>
                                                                </span>
                                                            </summary>
                                                            {expandedShots.has(shot.shot_id) && <div className="space-y-4 border-t border-border p-3 sm:p-4">
                                                                <div className="flex justify-end gap-1">
                                                                    <button type="button" onClick={() => updateBeat(sceneIndex, beatIndex, { shots: reindex(moveItem(beat.shots, shotIndex, -1)) })} disabled={locked || shotIndex === 0} aria-label={t("moveShotUp", { number: shotIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronUp size={15} aria-hidden="true" /></button>
                                                                    <button type="button" onClick={() => updateBeat(sceneIndex, beatIndex, { shots: reindex(moveItem(beat.shots, shotIndex, 1)) })} disabled={locked || shotIndex === beat.shots.length - 1} aria-label={t("moveShotDown", { number: shotIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><ChevronDown size={15} aria-hidden="true" /></button>
                                                                    <button type="button" onClick={() => updateBeat(sceneIndex, beatIndex, { shots: reindex(beat.shots.filter((_, index) => index !== shotIndex)) })} disabled={locked || beat.shots.length <= 1} aria-label={t("deleteShot", { number: shotIndex + 1 })} className="rounded p-2 text-text-secondary hover:bg-red-400/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><Trash2 size={15} aria-hidden="true" /></button>
                                                                </div>
                                            <div className="rounded-md border border-border bg-background/20 p-3">
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <Field label={t("fields.shotTitle")} value={shot.title} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { title: value })} />
                                                <Field label={t("fields.duration")} type="number" min={1} max={30} value={shot.duration_seconds} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { duration_seconds: value ? Number(value) : null })} />
                                                <div className="sm:col-span-2"><Field label={t("fields.visualIntent")} value={shot.visual_intent} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { visual_intent: value })} /></div>
                                                <div className="sm:col-span-2"><Field label={t("fields.directorEffect")} value={shot.director_effect} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { director_effect: value })} /></div>
                                                <Field label={t("fields.performanceAction")} value={shot.performance_action} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { performance_action: value })} />
                                                <Field label={t("fields.actionPhysics")} value={shot.action_physics} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { action_physics: value })} />
                                                <Field label={t("fields.shotSize")} value={shot.shot_size} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { shot_size: value })} />
                                                <Field label={t("fields.cameraAngle")} value={shot.camera_angle} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { camera_angle: value })} />
                                                <div className="sm:col-span-2"><Field label={t("fields.composition")} value={shot.composition} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { composition: value })} /></div>
                                                <Field label={t("fields.cameraMovement")} value={shot.camera_movement} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { camera_movement: value })} />
                                            </div>
                                            </div>
                                                                <details
                                                                    open={expandedShotContextIds.has(shot.shot_id)}
                                                                    className="rounded-md border border-border bg-background/30"
                                                                    onToggle={event => {
                                                                        const isOpen = event.currentTarget.open;
                                                                        setExpandedShotContextIds(previous => {
                                                                            const next = new Set(previous);
                                                                            if (isOpen) next.add(shot.shot_id);
                                                                            else next.delete(shot.shot_id);
                                                                            return next;
                                                                        });
                                                                    }}
                                                                >
                                                                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                                                                        <span>{t("advancedShotContextTitle")}</span>
                                                                        <span className="text-text-muted">{t("advancedShotContextHint")}</span>
                                                                    </summary>
                                                                    <div className="space-y-4 border-t border-border p-3">
                                                                        <div className="grid gap-3 sm:grid-cols-2">
                                                                            <Field label={t("fields.ambientSound")} value={shot.ambient_sound} multiline onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { ambient_sound: value })} />
                                                                        </div>
                                                                        <fieldset className="rounded-md border border-border p-3">
                                                                            <legend className="px-1 text-xs font-medium text-text-secondary">{t("fields.lighting")}</legend>
                                                                            {(() => {
                                                                                const conflict = lightingConflicts.find(item => item.shotId === shot.shot_id);
                                                                                const baseline = (plan.lighting_baselines ?? []).find(item =>
                                                                                    item.place_continuity_id === scene.place_continuity_id && item.time_continuity_id === scene.time_continuity_id);
                                                                                if (!conflict || !baseline) return null;
                                                                                const fieldNames = { key_source: "keySource", color_tone: "colorTone", contrast: "contrast", practical_sources: "practicalSources" } as const;
                                                                                return <div className="mb-3 rounded border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
                                                                                    <p className="font-medium">{t("lightingConflictComparisonTitle")}</p>
                                                                                    <p className="mt-1 leading-5">{t("lightingConflictComparisonHint")}</p>
                                                                                    <div className="mt-3 space-y-2">
                                                                                        {conflict.fields.map(field => <div key={field} className="rounded border border-amber-300/20 bg-background/50 p-2">
                                                                                            <p className="font-medium">{t(`fields.${fieldNames[field]}`)}</p>
                                                                                            <p className="mt-1"><span className="text-text-muted">{t("lightingBaselineValue")}</span> {Array.isArray(baseline.lighting[field]) ? baseline.lighting[field].join("、") || t("lightingEmptyValue") : baseline.lighting[field] || t("lightingEmptyValue")}</p>
                                                                                            <p className="mt-1"><span className="text-text-muted">{t("lightingShotValue")}</span> {Array.isArray(shot.lighting[field]) ? shot.lighting[field].join("、") || t("lightingEmptyValue") : shot.lighting[field] || t("lightingEmptyValue")}</p>
                                                                                            <button type="button" onClick={() => updateShot(sceneIndex, beatIndex, shotIndex, { lighting: { ...shot.lighting, [field]: baseline.lighting[field] } })} className="mt-2 rounded border border-amber-300/40 px-2 py-1 hover:bg-amber-300/10">{t("lightingUseBaseline")}</button>
                                                                                        </div>)}
                                                                                    </div>
                                                                                </div>;
                                                                            })()}
                                                                            <div className="mb-3"><Field label={t("fields.lightingOverrideReason")} value={shot.lighting_override_reason ?? ""} onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { lighting_override_reason: value })} /></div>
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
                                                                            <div className="lg:col-span-2">
                                                                                <Field
                                                                                    label={t("fields.castBindings")}
                                                                                    value={castBindingsText(shot.cast_bindings || [])}
                                                                                    multiline
                                                                                    placeholder={t("fields.castBindingsPlaceholder")}
                                                                                    onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, { cast_bindings: parseCastBindings(value) })}
                                                                                />
                                                                            </div>
                                                                            <Field
                                                                                label={t("fields.sceneAssetId")}
                                                                                value={shot.scene_binding?.scene_asset_id || ""}
                                                                                onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, {
                                                                                    scene_binding: { ...(shot.scene_binding || { binding_status: "selected" as const }), scene_asset_id: value || null },
                                                                                })}
                                                                            />
                                                                            <Field
                                                                                label={t("fields.interiorExterior")}
                                                                                value={shot.scene_binding?.interior_exterior || ""}
                                                                                placeholder={t("fields.interiorExteriorPlaceholder")}
                                                                                onChange={value => updateShot(sceneIndex, beatIndex, shotIndex, {
                                                                                    scene_binding: {
                                                                                        ...(shot.scene_binding || { binding_status: "selected" as const }),
                                                                                        interior_exterior: value === "interior" || value === "exterior" || value === "mixed" ? value : null,
                                                                                    },
                                                                                })}
                                                                            />
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
                                                                    </div>
                                                                </details>
                                                            </div>}
                                                        </details>
                                                    ))}
                                                    <button type="button" onClick={() => updateBeat(sceneIndex, beatIndex, { shots: [...beat.shots, emptyShot(beat.shots.length)] })} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-text-secondary hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus size={15} aria-hidden="true" />{t("addShot")}</button>
                                                </div>
                                            </article>
                                        ))}
                                        <button type="button" onClick={() => updateScene(sceneIndex, { beats: [...scene.beats, emptyBeat(scene.beats.length)] })} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-text-secondary hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus size={15} aria-hidden="true" />{t("addBeat")}</button>
                                    </div>
                                </div>}
                            </section>
                        ))}
                        <button type="button" onClick={() => updatePlan(current => ({ ...current, scenes: [...current.scenes, emptyScene(current.scenes.length)] }))} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-dashed border-border px-4 text-sm text-text-secondary hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus size={16} aria-hidden="true" />{t("addScene")}</button>
                    </div>

                    <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                            {dirty ? <AlertCircle size={16} className="text-amber-300" aria-hidden="true" /> : <Check size={16} className="text-emerald-300" aria-hidden="true" />}
                            <span>{dirty ? t("unsaved") : t("savedDraft", { revision: serverState?.draft_revision ?? 0 })}</span>
                        </div>
                        <details className="min-w-0">
                            <summary className="cursor-pointer text-xs text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t("revisionMetadata")}</summary>
                            <div className="mt-2 flex min-w-[18rem] flex-wrap gap-2">
                                <input value={revisionTitle} onChange={event => setRevisionTitle(event.target.value)} placeholder={t("revisionTitlePlaceholder")} aria-label={t("revisionTitle")} className="min-h-9 min-w-48 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground" />
                                <input value={revisionSummary} onChange={event => setRevisionSummary(event.target.value)} placeholder={t("revisionSummaryPlaceholder")} aria-label={t("revisionSummary")} className="min-h-9 min-w-56 flex-[2] rounded-md border border-border bg-background px-2 text-xs text-foreground" />
                            </div>
                        </details>
                        <div className="flex flex-wrap gap-2">
                            {dirty && <button type="button" onClick={() => { const previous = savedPlan ?? serverState?.draft ?? null; setPlan(previous); setSavedPlan(previous); setNotice(""); }} disabled={locked} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"><RotateCcw size={15} aria-hidden="true" />{t("discardChanges")}</button>}
                            <button type="button" onClick={() => void save()} disabled={locked || !dirty || !plan} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"><Save size={15} aria-hidden="true" />{action === "save" ? t("saving") : t("saveDraft")}</button>
                            <button type="button" onClick={confirmPlan} disabled={locked || dirty || !plan || draftStale || Boolean(serverState?.readiness_error) || lightingConflicts.length > 0} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 size={15} aria-hidden="true" />{action === "confirm" ? t("confirming") : t("confirmPlan")}</button>
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

            {matchingHistory.length > 0 && (
                <section className="rounded-lg border border-border bg-background/40 p-4" aria-labelledby="director-plan-history-title">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 id="director-plan-history-title" className="text-sm font-semibold text-foreground">{t("historyTitle")}</h3>
                            <p className="mt-1 text-xs text-text-muted">{t("historyHint")}</p>
                        </div>
                        <span className="rounded-full border border-border px-2 py-1 text-xs text-text-secondary">{t("currentVersion", { revision: matchingHistory[0].revision })}</span>
                    </div>
                    <ol className="space-y-2">
                        {matchingHistory.map(item => {
                            const lineage = serverState?.current_lineage;
                            const isStale = !lineage
                                || item.source_revision !== lineage.source_revision
                                || item.source_revision_id !== lineage.source_revision_id
                                || item.director_profile_revision !== lineage.director_profile_revision
                                || item.director_profile_hash !== lineage.director_profile_hash;
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
