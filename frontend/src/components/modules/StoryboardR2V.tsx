"use client";

import { createFrameEditQueue } from "@/lib/frameEditQueue";
import { editShotSettings } from "./storyboard-r2v/shotPromptSettings";
import { storyboardAudioChoice, storyboardGeneratedAudio } from "./storyboard-r2v/generatedAudio";
import { resolveShotVideoInput } from "./storyboard-r2v/shotVideoInput";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Plus, Loader2, Sparkles, PanelBottomOpen, PanelBottomClose } from "lucide-react";
import StepPageHeader, { StepPill } from "@/components/shared/StepPageHeader";
import RenderPromptPreviewDialog, { type FrameRenderPreview } from "./RenderPromptPreviewDialog";
import { useTranslations } from "next-intl";
import { useProjectStore } from "@/store/projectStore";
import { api, crudApi, type VideoTask, type RefineSSEEvent, type AssetReferenceIndexEntry, type EpisodeCharacterUse } from "@/lib/api";
import { resolveMediaDelivery, resolveVideoTaskDelivery } from "@/lib/mediaDelivery";
import { resolveStoryboardStyle, resolveStoryboardStyleForRender } from "@/lib/storyboardStyle";
import { getAssetUrl } from "@/lib/utils";
import { isUniArtVoiceBinding } from "@/lib/voiceBinding";
import { debugLog } from "@/lib/debugLog";
import type { BatchSummary } from "./storyboard-r2v/shot-panel/CandidatesSection";
import { getR2vRouteModelId, isR2vImageBased, videoModelSupportsMode, VIDEO_I2V_MODELS, VIDEO_R2V_MODELS, DEFAULT_I2V_MODEL_ID, DEFAULT_R2V_MODEL_ID } from "@/lib/modelCatalog";

const preferredVideoModel = (models: { id: string }[], fallback: string) =>
    models.find(model => model.id === 'nsfw/wan3.0')?.id ?? models[0]?.id ?? fallback;
import ShotCard, { type ShotNode } from "./storyboard-r2v/ShotCard";
import {
    buildGenerationPrompt,
    resolveNegativePrompt,
    resolveStylePrompt,
} from "./storyboard-r2v/buildAssembledPrompt";
import DialogueAudioRow from "./storyboard-r2v/DialogueAudioRow";
import StoryboardGenerateDialog from "./storyboard-r2v/StoryboardGenerateDialog";
import StoryboardAnalysisModal from "./storyboard-r2v/StoryboardAnalysisModal";
import type {
    StoryboardAnalysisLineage,
    StoryboardDraftFrame,
} from "@/lib/storyboardAnalysis";
import { toast } from "@/store/toastStore";
import { Wand2 } from "lucide-react";
import AssetDrawer from "./storyboard-r2v/AssetDrawer";
import ShotCharacterUsePicker from "./storyboard-r2v/ShotCharacterUsePicker";
import { characterUseReferenceError } from "./storyboard-r2v/shotCharacterUseSubmission";
import { type VideoConfig, DEFAULT_VIDEO_CONFIG } from "./storyboard-r2v/VideoConfigModal";
import {
    migrateShotNode,
    appendT2IImage,
    setActiveT2IIndex,
    removeT2IImage,
    getActiveT2IImageUrl,
    frameToShotNode,
} from "./storyboard-r2v/shotNodeHelpers";
import { overridePanelSectionState } from "./storyboard-r2v/shot-panel/usePanelSectionState";
import ParamsSection, { type ParamsState } from "./storyboard-r2v/shot-panel/ParamsSection";
import T2ISubsection from "./storyboard-r2v/shot-panel/T2ISubsection";
import CandidatesSection from "./storyboard-r2v/shot-panel/CandidatesSection";
import CompareModal from "./storyboard-r2v/shot-panel/CompareModal";
import TaskQueueButton from "./storyboard-r2v/shot-panel/TaskQueueButton";
import TaskQueuePanel from "./storyboard-r2v/shot-panel/TaskQueuePanel";
import { GenerationBanner, type BannerState } from "./storyboard-r2v/GenerationBanner";
import {
    bindH3MultiReferencePrompt,
    buildReferenceAssets,
    refreshReferenceSubmission,
    H3_MAX_REFERENCE_IMAGES,
    resolveReferenceSubmission,
    type ReferenceAsset,
} from "./storyboard-r2v/referenceAssets";

export default function StoryboardR2V() {
    const candidateRenderBusyRef = useRef(false);
    const [pendingCandidate, setPendingCandidate] = useState<{
        projectId: string; frameId: string; slot: "first" | "last";
        preview: FrameRenderPreview;
    } | null>(null);
    const currentProject = useProjectStore((state) => state.currentProject);
    const currentSeries = useProjectStore((state) => state.currentSeries);
    const updateProject = useProjectStore((state) => state.updateProject);
    const t = useTranslations("storyboardR2V");
    const tStep = useTranslations("stepHeader");
    const [indexedProject, setIndexedProject] = useState<{
        projectId: string; assets: AssetReferenceIndexEntry[];
    }>();
    const [assetIndexError, setAssetIndexError] = useState("");
    const assetIndex = indexedProject?.projectId === currentProject?.id ? indexedProject?.assets : undefined;
    const displayedStyle = currentProject
        ? resolveStoryboardStyle(currentProject, currentSeries)
        : { positivePrompt: "", negativePrompt: "" };
    const loadGenerationStyle = useCallback(() => {
        if (!currentProject) throw new Error("Project is unavailable");
        return resolveStoryboardStyleForRender(currentProject, currentSeries, api.getSeries);
    }, [currentProject, currentSeries]);

    useEffect(() => {
        const projectId = currentProject?.id;
        if (!projectId || typeof api.getProjectAssetReferenceIndex !== "function") return;
        let active = true;
        setAssetIndexError("");
        void api.getProjectAssetReferenceIndex(projectId)
            .then((index) => { if (active) setIndexedProject({ projectId, assets: index.assets }); })
            .catch((error) => {
                if (!active) return;
                setAssetIndexError("项目资产读取失败，请重试。");
                debugLog.error("Studio", "Asset index load failed", error);
            });
        return () => { active = false; };
    }, [currentProject?.id, currentProject?.characters, currentProject?.scenes, currentProject?.props]);

    // Episode looks are a live, user-confirmed index. Refresh them when the
    // shot workbench opens so a look confirmed in Character Workbench or
    // another tab is searchable without a full page reload.
    useEffect(() => {
        const projectId = currentProject?.id;
        if (!projectId || typeof api.listEpisodeCharacterUses !== "function") return;
        let active = true;
        void api.listEpisodeCharacterUses(projectId)
            .then((uses) => {
                if (active) updateProject(projectId, { episode_character_uses: uses });
            })
            .catch(() => { /* project snapshot remains usable while refreshing */ });
        return () => { active = false; };
    }, [currentProject?.id, updateProject]);

    // Derive shots from project frames. Workbench state (T2I 抽卡
    // history, last-active tab, batch count) now comes from backend-
    // persisted frame fields (added in commit 9149b06) instead of
    // React-only state, so cross-refresh / cross-device users see the
    // same panel state. migrateShotNode still runs as a defensive
    // belt-and-suspenders for very old localStorage drafts.
    const [shots, setShots] = useState<ShotNode[]>(() => {
        if (currentProject?.frames && currentProject.frames.length > 0) {
            const videoTasks: any[] = (currentProject as any).video_tasks ?? [];
            return currentProject.frames.map((frame: any) => frameToShotNode(frame, videoTasks));
        }
        return [migrateShotNode({ id: `shot_${Date.now()}`, prompt: "", tabMode: "direct_r2v" })];
    });

    // Global video config (with localStorage persistence for model selection)
    const [videoConfig, setVideoConfig] = useState<VideoConfig>(() => {
        const ls = typeof window !== 'undefined' ? window.localStorage : null;
        const savedI2v = ls?.getItem('storyboard-r2v-model') ?? null;
        const savedR2v = ls?.getItem('storyboard-r2v-r2v-model') ?? null;
        const projectI2v = currentProject?.model_settings?.i2v_model || DEFAULT_I2V_MODEL_ID;

        // I2V — defensive: a cached localStorage model id may have been
        // hidden or removed from the I2V list since it was last
        // selected (e.g. the user once picked `wan2.7-r2v` while it was
        // visible, the catalog later marked it hidden, and now the ID
        // lingers in their browser). Falling back to the default avoids
        // silently shipping the wrong model into the I2V flow.
        const i2vCandidate = savedI2v || projectI2v;
        const i2vOk = VIDEO_I2V_MODELS.find(m => m.id === i2vCandidate);
        const i2vModelId = i2vOk ? i2vCandidate : preferredVideoModel(VIDEO_I2V_MODELS, DEFAULT_I2V_MODEL_ID);
        if (!i2vOk && ls && savedI2v) {
            ls.removeItem('storyboard-r2v-model');
            debugLog.warn(
                "Studio",
                `Cached I2V model "${i2vCandidate}" is no longer in the visible I2V list; ` +
                `falling back to "${DEFAULT_I2V_MODEL_ID}".`,
            );
        }

        // R2V preference order:
        //   1. localStorage (user's last explicit pick — survives reloads)
        //   2. project.model_settings.r2v_model (project-level default,
        //      set in 生成设置 — Plan B "specialize" hierarchy)
        //   3. derived from i2v family (initial coherence on first mount)
        //   4. catalog DEFAULT_R2V_MODEL_ID
        // Each candidate is validated against VIDEO_R2V_MODELS so a
        // hidden id from any layer falls through cleanly.
        const projectR2v = currentProject?.model_settings?.r2v_model;
        const r2vDerived = getR2vRouteModelId(i2vModelId);
        const r2vCandidate = savedR2v || projectR2v || r2vDerived || DEFAULT_R2V_MODEL_ID;
        const r2vOk = VIDEO_R2V_MODELS.find(m => m.id === r2vCandidate);
        const r2vModelId = r2vOk ? r2vCandidate : preferredVideoModel(VIDEO_R2V_MODELS, DEFAULT_R2V_MODEL_ID);
        if (!r2vOk && ls && savedR2v) {
            ls.removeItem('storyboard-r2v-r2v-model');
        }

        const finalConfig = VIDEO_I2V_MODELS.find(m => m.id === i2vModelId);
        const dc = finalConfig?.duration;
        const defaultDuration = dc ? (dc.type === 'fixed' ? dc.value : dc.default) : 5;
        return {
            ...DEFAULT_VIDEO_CONFIG,
            model: i2vModelId,
            r2vModel: r2vModelId,
            duration: defaultDuration,
            ratio: finalConfig?.params?.ratio?.default
                ?? VIDEO_R2V_MODELS.find(m => m.id === r2vModelId)?.params?.ratio?.default
                ?? DEFAULT_VIDEO_CONFIG.ratio,
        };
    });

    useEffect(() => {
        const refreshSelection = () => {
            setVideoConfig(current => ({
                ...current,
                model: VIDEO_I2V_MODELS.some(item => item.id === current.model)
                    ? current.model : preferredVideoModel(VIDEO_I2V_MODELS, DEFAULT_I2V_MODEL_ID),
                r2vModel: VIDEO_R2V_MODELS.some(item => item.id === current.r2vModel)
                    ? current.r2vModel : preferredVideoModel(VIDEO_R2V_MODELS, DEFAULT_R2V_MODEL_ID),
            }));
        };
        window.addEventListener('lumenx:uniart-catalog-refreshed', refreshSelection);
        return () => window.removeEventListener('lumenx:uniart-catalog-refreshed', refreshSelection);
    }, []);

    // Modal & drawer state (configModalOpen retired with the gear; the
    // old VideoConfigModal mount is gone, replaced by per-shot
    // ParamsSection panels under each ShotCard. handleConfigChange is
    // also gone — model writes now flow through handleShotParamsChange
    // below, which mirrors them to localStorage.)
    const [drawerState, setDrawerState] = useState<{ isOpen: boolean; targetShotIndex: number | null; frameSlot?: "first" | "last" }>({
        isOpen: false,
        targetShotIndex: null,
    });

    // Task-queue side panel state. Persisted across renders only; we
    // intentionally don't localStorage this — it's transient "I want
    // to peek at queue" UI affordance, not a saved layout preference.
    const [queueOpen, setQueueOpen] = useState(false);

    // Compare-mode selection: a Set of task ids the user shift-clicked
    // in any shot's candidate panel. Multi-shot compare is a future
    // feature; for now the same Set is shared across shots so user
    // can only effectively compare within one shot at a time. Cleared
    // on Compare modal close.
    const [compareSelectedIds, setCompareSelectedIds] = useState<Set<string>>(() => new Set());
    const [compareModalOpen, setCompareModalOpen] = useState(false);

    // Refs map for textareas (for asset insertion from drawer)
    const textareaRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());
    // Refs to each shot's outer wrapper so the task-queue panel can
    // jump-scroll the canvas to a specific frame.
    const shotWrapperRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    // Per-shot submission lockout (Issue 17) — debounce double-clicks and
    // strict-mode double-effects. Holds shot.id strings; entries auto-expire
    // after 500ms via setTimeout in generateVideoBatch.
    const submittingShotsRef = useRef<Set<string>>(new Set());

    // Inline per-shot validation error messages (shown by ParamsSection
    // below the Generate CTA). Used for pre-flight failures like
    // "R2V needs reference images" that we catch before hitting the
    // backend, so the user gets immediate feedback instead of a
    // task that queues, fails, and shows up only in the diagnose log.
    const [shotErrors, setShotErrors] = useState<Record<string, string>>({});
    const [lookBusyFrameId, setLookBusyFrameId] = useState<string | null>(null);
    const [extractingPreviousEndFrameId, setExtractingPreviousEndFrameId] = useState<string | null>(null);
    const missingRefsMessage = useCallback(
        (modelLabel: string) =>
            t("missingRefs", { model: modelLabel }),
        [t],
    );

    // Per-shot seed override. The Seed advanced param doesn't live in
    // videoConfig (seeds are inherently per-generation; sharing one
    // across shots would defeat the "different shots = different
    // creative takes" expectation). Without this state the seed
    // input + dice button would appear to do nothing because
    // ParamsSection.set("seed", N) flowed up to handleShotParamsChange,
    // which silently dropped it, so the next paramsStateForShot()
    // call would always rebuild params.seed = undefined.
    //
    // `undefined` means "no explicit seed" (provider picks). Any
    // number means "use this exact seed" — same for all takes in a
    // batch (intentional: ×N with a fixed seed = N runs at that seed
    // for ablation testing). Users who want N varied takes leave it
    // empty.
    const [shotSeeds, setShotSeeds] = useState<Record<string, number | undefined>>({});

    // Per-shot batch count (the "抽卡 ×N" knob). Decoupled from
    // videoConfig because users typically pick the model + duration
    // once and vary count per shot. Keyed by shot.id so insert/move
    // don't shuffle counts onto the wrong shot. Seeded from backend
    // workbench_generate_count so user choices survive refresh.
    const [shotCounts, setShotCounts] = useState<Record<string, number>>(() => {
        const out: Record<string, number> = {};
        const frames: any[] = currentProject?.frames ?? [];
        for (const f of frames) {
            if (typeof f.workbench_generate_count === "number") {
                out[f.id] = f.workbench_generate_count;
            }
        }
        return out;
    });

    // Issue 16 — per-shot expand state (P plan). Default: all collapsed
    // (browse mode). Set persists per project to localStorage so coming back
    // to the project restores the user's last working layout.
    const expandStorageKey = currentProject ? `storyboard-r2v-expanded-${currentProject.id}` : null;
    const [expandedShots, setExpandedShots] = useState<Set<string>>(() => {
        if (typeof window === "undefined" || !expandStorageKey) return new Set();
        try {
            const raw = window.localStorage.getItem(expandStorageKey);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) return new Set(arr.filter(x => typeof x === "string"));
            }
        } catch { /* corrupt localStorage value — ignore */ }
        return new Set();
    });
    // Persist on change.
    useEffect(() => {
        if (typeof window === "undefined" || !expandStorageKey) return;
        try {
            window.localStorage.setItem(expandStorageKey, JSON.stringify(Array.from(expandedShots)));
        } catch { /* quota exceeded — ignore */ }
    }, [expandedShots, expandStorageKey]);

    const toggleShotExpanded = useCallback((shotId: string) => {
        setExpandedShots(prev => {
            const next = new Set(prev);
            if (next.has(shotId)) next.delete(shotId);
            else next.add(shotId);
            return next;
        });
    }, []);
    const expandAllShots = useCallback(() => {
        const ids = shots.map(s => s.id);
        // Force every inner section open — overrides each shot's sticky
        // preference. Section keys must match what ParamsSection /
        // CandidatesSection register inside their SectionShells.
        overridePanelSectionState(ids, ["params", "candidates"], true);
        setExpandedShots(new Set(ids));
    }, [shots]);
    const collapseAllShots = useCallback(() => {
        // Don't reset section preferences here — sticky memory should
        // survive a global collapse so re-expanding a shot returns to
        // the user's chosen drawer state.
        setExpandedShots(new Set());
    }, []);

    // Debounced backend writer for workbench state. Coalesces rapid
    // changes (e.g. user clicking through T2I thumbs) into one PATCH
    // per shot per second. Per-shot map ensures one shot's pending
    // write doesn't get overwritten by another's.
    const workbenchPendingRef = useRef<Map<string, {
        timer: number;
        patch: Parameters<typeof api.updateFrameWorkbench>[2];
    }>>(new Map());
    const persistWorkbench = useCallback((
        shotId: string,
        patch: Parameters<typeof api.updateFrameWorkbench>[2],
    ) => {
        if (!currentProject?.id) return;
        // Synthetic shot id (not yet materialized on backend) — skip; the
        // workbench state will be re-applied after createFrame swaps the id.
        if (shotId.startsWith("shot_")) return;
        const projectId = currentProject.id;
        const map = workbenchPendingRef.current;
        const existing = map.get(shotId);
        const merged = { ...(existing?.patch ?? {}), ...patch };
        if (existing) {
            window.clearTimeout(existing.timer);
        }
        const timer = window.setTimeout(() => {
            map.delete(shotId);
            api.updateFrameWorkbench(projectId, shotId, merged)
                .then(() => {
                    // Sync store so other tabs (or remount on tab switch)
                    // see the latest workbench state. Read store live to
                    // avoid stale closure.
                    const proj = useProjectStore.getState().currentProject;
                    if (!proj || proj.id !== projectId) return;
                    const nextFrames = (proj.frames ?? []).map((f: any) =>
                        f.id === shotId ? { ...f, ...merged } : f,
                    );
                    updateProject(projectId, { frames: nextFrames });
                })
                .catch((err) => {
                    debugLog.warn("Studio", "Failed to persist workbench state:", err);
                });
        }, 1000);
        map.set(shotId, { timer, patch: merged });
    }, [currentProject?.id, updateProject]);

    const usePreviousVideoEndFrame = useCallback(async (index: number) => {
        const shot = shots[index];
        const frames = currentProject?.frames ?? [];
        const frameIndex = frames.findIndex((frame: any) => frame.id === shot?.id);
        if (!currentProject || !shot || frameIndex <= 0 || extractingPreviousEndFrameId) return;
        const previousFrame = frames[frameIndex - 1];
        const selectedTask = (currentProject.video_tasks ?? []).find((task: any) =>
            task.id === previousFrame.selected_video_id
            && task.frame_id === previousFrame.id
            && task.status === "completed"
            && task.video_url,
        );
        if (!selectedTask) return;

        setExtractingPreviousEndFrameId(shot.id);
        let pendingPatch: Parameters<typeof api.updateFrameWorkbench>[2] | null = null;
        try {
            const extracted = await api.extractLastFrame(currentProject.id, shot.id, selectedTask.id);
            const extractedFrame = extracted.frames?.find((frame: any) => frame.id === shot.id);
            const selectedVariant = extractedFrame?.rendered_image_asset?.variants?.find((variant: any) =>
                variant.id === extractedFrame.rendered_image_asset.selected_id,
            );
            // Workbench history must contain the durable storage key, never
            // the short-lived URL returned by signed_response.
            const imageKey = selectedVariant?.storage_key;
            if (!imageKey) throw new Error("尾帧截取未返回稳定素材路径");
            const urls = [...(shot.t2iImageUrls ?? []), imageKey].slice(-10);
            const selectedIndex = urls.length - 1;
            const pending = workbenchPendingRef.current.get(shot.id);
            if (pending) {
                pendingPatch = pending.patch;
                window.clearTimeout(pending.timer);
                workbenchPendingRef.current.delete(shot.id);
            }
            const savedFrame = await api.updateFrameWorkbench(currentProject.id, shot.id, {
                ...(pending?.patch ?? {}),
                t2i_image_urls: urls,
                t2i_selected_index: selectedIndex,
            });
            updateProject(currentProject.id, {
                frames: extracted.frames.map((frame: any) => frame.id === shot.id
                    ? { ...savedFrame, t2i_image_urls: urls, t2i_selected_index: selectedIndex }
                    : frame),
            });
            setShots(prev => prev.map(item => item.id === shot.id ? {
                ...item,
                imageUrl: extractedFrame.rendered_image_url,
                t2iImageUrls: urls,
                t2iSelectedIndex: selectedIndex,
                t2iImageUrl: imageKey,
            } : item));
        } catch (error: any) {
            if (pendingPatch) persistWorkbench(shot.id, pendingPatch);
            const message = error?.response?.data?.detail || error?.message || "无法截取上一镜头尾帧";
            setShotErrors(prev => ({ ...prev, [shot.id]: String(message) }));
            toast.warning(String(message));
        } finally {
            setExtractingPreviousEndFrameId(null);
        }
    }, [shots, currentProject, extractingPreviousEndFrameId, updateProject, persistWorkbench]);

    // Adopted text, its flag and editable direction share one ordered writer.
    const frameEdits = useMemo(() => createFrameEditQueue(
        (projectId, shotId, patch) => api.updateFrame(projectId, shotId, patch),
        (projectId, shotId, patch, result) => {
            const proj = useProjectStore.getState().currentProject;
            if (!proj || proj.id !== projectId) return;
            const saved = result?.frames?.find((frame: any) => frame.id === shotId);
            const fields = { ...patch };
            if (saved && ("style_prompt_override" in patch || "lighting_override" in patch)) {
                for (const key of ["image_prompt", "image_prompt_en", "image_prompt_cn"]) fields[key] = saved[key];
            }
            if (saved && "workbench_prompt_is_optimized" in patch) fields.visual_description = saved.visual_description;
            updateProject(projectId, { frames: (proj.frames ?? []).map((frame: any) =>
                frame.id === shotId ? { ...frame, ...fields } : frame) });
        },
        (error) => {
            debugLog.warn("Studio", "Frame edit save failed", error);
            toast.error(t("shotEditSaveFailed"), { action: {
                label: t("polishRetry"), onClick: () => { void frameEdits.flush().catch(() => {}); },
            } });
        },
    ), [updateProject]);
    const persistFrameEdit = useCallback((shotId: string, patch: Parameters<typeof api.updateFrame>[2]) => {
        if (!currentProject?.id || shotId.startsWith("shot_")) return;
        frameEdits.enqueue(currentProject.id, shotId, patch);
    }, [currentProject?.id, frameEdits]);

    // Flush all pending writes on unmount (e.g. user switches step tab)
    // so the last keystroke / param change isn't stranded in the debounce
    // window. Workbench media state remains separate from prompt edits.
    useEffect(() => {
        const wbMap = workbenchPendingRef.current;
        return () => {
            const projectId = currentProject?.id;
            if (!projectId) return;
            for (const [shotId, entry] of Array.from(wbMap.entries())) {
                window.clearTimeout(entry.timer);
                api.updateFrameWorkbench(projectId, shotId, entry.patch).catch(() => {});
            }
            wbMap.clear();
            void frameEdits.flush().catch(() => {});
        };
    }, [currentProject?.id, frameEdits]);

    // beforeunload guard: warn when structured field edits are pending
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (frameEdits.hasPending()) {
                e.preventDefault();
            }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [frameEdits]);

    const characters = currentProject?.characters || [];
    const scenes = currentProject?.scenes || [];
    const props = currentProject?.props || [];

    const selectShotCharacterUse = useCallback(async (frameId: string, use: EpisodeCharacterUse) => {
        if (!currentProject || lookBusyFrameId) return;
        const frame = currentProject.frames.find((item: any) => item.id === frameId);
        if (!frame) return;
        setLookBusyFrameId(frameId);
        try {
            const updated = await api.selectFrameCharacterUse(currentProject.id, frameId, {
                project_character_id: use.project_character_id,
                use_id: use.use_id,
                expected_reference_revision: frame.reference_package?.revision ?? 1,
            });
            if (useProjectStore.getState().currentProject?.id !== currentProject.id) return;
            updateProject(currentProject.id, updated);
            const saved = updated.frames?.find((item: any) => item.id === frameId);
            if (saved) setShots((previous) => previous.map((item) => item.id === frameId
                ? { ...item, referenceVariantIds: saved.workbench_reference_variant_ids || {} }
                : item));
            toast.success(`已选择本镜头造型：${use.label}。请核对首帧和提示词引用。`);
        } catch (error: any) {
            toast.error(String(error?.response?.data?.detail || error?.message || "镜头造型选择失败"));
        } finally {
            setLookBusyFrameId(null);
        }
    }, [currentProject, lookBusyFrameId, updateProject]);

    // ────────────────────────────────────────────────────────────────────
    // Shot mutations — Optimistic UI + 异步同步后端 + store 更新
    //   Pattern: 立即改本地 state（无闪烁），后台 fire-and-forget call
    //   到 backend，成功后 swap synthetic id with real id（addShot/duplicate）
    //   并 updateProject(store) 让 currentProject.frames 保持权威。
    //   失败仅 log warn，不回滚（避免 UI 闪烁；用户可重试）。
    //   切 step tab → unmount 时 useEffect cleanup 已经 flush pending
    //   debounce writes，所以打字到一半切走也不丢字。
    // ────────────────────────────────────────────────────────────────────

    // Add a new shot after the given index
    const addShot = useCallback(async (afterIndex: number) => {
        const synthId = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // PR-3e · pick default tabMode from project preference (inherited from
        // series). "i2v" (画面优先) → t2i_i2v; "r2v" (节奏优先, default) → direct_r2v.
        const defaultMode = currentProject?.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v";
        const newShot: ShotNode = {
            id: synthId,
            prompt: "",
            tabMode: defaultMode,
        };
        setShots(prev => {
            const updated = [...prev];
            updated.splice(afterIndex + 1, 0, newShot);
            return updated;
        });
        // Issue 16 — newly-created shots default to expanded so the user
        // can immediately operate on them. Existing shots keep their state.
        setExpandedShots(prev => {
            const next = new Set(prev);
            next.add(synthId);
            return next;
        });
        if (!currentProject?.id) return;
        try {
            const resp = await crudApi.createFrame(currentProject.id, {
                scene_id: "",
                action_description: "",
                insert_at: afterIndex + 1,
            });
            const frames = Array.isArray(resp?.frames) ? resp.frames : null;
            const realFrame = frames?.[Math.min(afterIndex + 1, frames.length - 1)];
            if (realFrame?.id) {
                setShots(prev => prev.map(s => s.id === synthId ? { ...s, id: realFrame.id } : s));
                setExpandedShots(prev => {
                    if (!prev.has(synthId)) return prev;
                    const next = new Set(prev);
                    next.delete(synthId);
                    next.add(realFrame.id);
                    return next;
                });
            }
            if (frames) updateProject(currentProject.id, { frames });
        } catch (err) {
            debugLog.warn("Studio", "addShot backend persist failed", err);
        }
    }, [currentProject, updateProject]);

    // PR-3 followup · LLM storyboard generation. State + handler live at
    // the StoryboardR2V level (not in a sub-component) because the toast
    // lifecycle survives the dialog closing and we need the parent to
    // setShots() when the new frames come back.
    const [genDialogOpen, setGenDialogOpen] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number } | null>(null);
    const [storyboardDraft, setStoryboardDraft] = useState<StoryboardDraftFrame[] | null>(null);
    const [storyboardDraftLineage, setStoryboardDraftLineage] = useState<StoryboardAnalysisLineage | null>(null);
    const [storyboardDraftText, setStoryboardDraftText] = useState("");
    const [storyboardFeedback, setStoryboardFeedback] = useState<string[]>([]);
    const [storyboardDraftBusy, setStoryboardDraftBusy] = useState(false);
    const [richRefinementBusyFrameId, setRichRefinementBusyFrameId] = useState<string | null>(null);
    const [bannerState, setBannerState] = useState<BannerState>(
        () => (currentProject?.frames?.length ?? 0) > 0 ? "summary" : "idle"
    );
    const [refineProgress, setRefineProgress] = useState<{ current: number; total: number } | null>(null);
    const [dialogueProgress, setDialogueProgress] = useState<{ current: number; total: number } | null>(null);

    const PHASE1_CAPTIONS = useMemo(() => [
        "正在分析剧本结构…",
        "识别场景切换点…",
        "拆分镜头与动作…",
        "琢磨每帧的构图和节奏…",
        "快了，安排景别和运镜…",
        "最后润色一下…",
    ], []);

    const bannerSummary = useMemo(() => {
        if (!currentProject?.frames?.length) return null;
        const frames = currentProject.frames as any[];
        const frameCount = frames.length;
        const withDialogue = frames.filter((f: any) =>
            f.dialogue_structured?.line || f.dialogue
        );
        const charsWithVoice = new Set(
            (currentProject as any).characters?.filter((c: any) => isUniArtVoiceBinding(c.voice_id)).map((c: any) => c.id) ?? []
        );
        const charNameToVoice = new Map<string, boolean>(
            (currentProject as any).characters?.filter((c: any) => isUniArtVoiceBinding(c.voice_id)).map((c: any) => [c.name?.toLowerCase(), true]) ?? []
        );
        const hasVoiceBinding = (f: any): boolean => {
            if (f.character_ids?.[0] && charsWithVoice.has(f.character_ids[0])) return true;
            const speaker = f.dialogue_structured?.speaker || f.speaker;
            return !!(speaker && charNameToVoice.has(speaker.toLowerCase()));
        };
        const dialogueReady = withDialogue.filter((f: any) =>
            hasVoiceBinding(f) && !f.audio_url
        ).length;
        const dialogueMissing = withDialogue.filter((f: any) => !hasVoiceBinding(f)).length;
        return { frameCount, dialogueReady, dialogueMissing };
    }, [currentProject?.frames, (currentProject as any)?.characters]);

    const handleBatchDialogue = useCallback(async () => {
        if (!currentProject?.id) return;
        setBannerState("dialogue");
        setDialogueProgress(null);
        try {
            const frames = currentProject.frames as any[] ?? [];
            const totalWithDialogue = frames.filter((f: any) => f.dialogue_structured?.line || f.dialogue).length;
            setDialogueProgress({ current: 0, total: totalWithDialogue });
            const result = await api.generateDialogueAudioBatch(currentProject.id);
            const stats = result._batch_stats;
            if (stats.failed > 0) {
                toast.warning(`对白生成完成：${stats.generated} 条成功，${stats.failed} 条失败`);
            } else if (stats.generated > 0) {
                toast.success(`已生成 ${stats.generated} 条对白音频`);
            } else if (stats.no_voice > 0 && stats.skipped === 0) {
                toast.warning(`${stats.no_voice} 条对白的角色尚未绑定语音`);
            } else if (stats.skipped > 0) {
                toast.success(t("dialogueAllUpToDate"));
            } else {
                toast.warning("未找到可生成的对白");
            }
            const updated = await api.getProject(currentProject.id);
            if (updated?.frames) updateProject(currentProject.id, { frames: updated.frames });
        } catch (e) {
            debugLog.error("Studio", "batch dialogue audio failed", e);
            toast.error(t("batchDialogueFailed"));
        } finally {
            setBannerState("summary");
            setDialogueProgress(null);
        }
    }, [currentProject, updateProject]);

    const applyStoryboardFrames = useCallback(async (
        projectId: string, scriptText: string, frames: StoryboardDraftFrame[],
        lineage: StoryboardAnalysisLineage, defaultMode: "t2i_i2v" | "direct_r2v",
    ) => {
        try {
            const updated = await api.applyStoryboardDraft(
                projectId, scriptText, frames, lineage,
            );
            const newFrameCount = Array.isArray(updated?.frames) ? updated.frames.length : 0;
            updateProject(projectId, updated);
            if (Array.isArray(updated?.frames) && useProjectStore.getState().currentProject?.id === projectId) {
                const videoTasks: any[] = updated.video_tasks ?? [];
                setShots(updated.frames.map((frame: any) => frameToShotNode(frame, videoTasks, defaultMode)));
            }
            if (newFrameCount > 0) {
                if (useProjectStore.getState().currentProject?.id === projectId) {
                    setBannerState("phase2");
                    setRefineProgress({ current: 0, total: newFrameCount });
                }
                let initializationFailed = 0;
                try {
                    const initialization = await api.initializeBatchFrames(projectId, (event: RefineSSEEvent) => {
                        if (event.type === "frame_initialize_start" && useProjectStore.getState().currentProject?.id === projectId) {
                            setRefineProgress({ current: (event.frame_index ?? 0) + 1, total: event.total ?? newFrameCount });
                        }
                    });
                    initializationFailed = initialization.failed;
                    const refreshed = await api.getProject(projectId);
                    if (refreshed?.frames && useProjectStore.getState().currentProject?.id === projectId) {
                        updateProject(projectId, { frames: refreshed.frames });
                        const videoTasks: any[] = refreshed.video_tasks ?? [];
                        setShots(refreshed.frames.map((frame: any) => frameToShotNode(frame, videoTasks, defaultMode)));
                    }
                } catch (error: any) {
                    initializationFailed = newFrameCount;
                    const detail = error?.response?.data?.detail || error?.message || t("genToastErrUnknown");
                    toast.error(`${t("genToastErr")}: ${String(detail).slice(0, 200)}`);
                }
                if (initializationFailed) toast.error(t("initializePartial", { count: initializationFailed }));
            }
            if (useProjectStore.getState().currentProject?.id === projectId) setBannerState("summary");
            toast.success(t(lineage.storyboard_mode === "plan" ? "planApplied" : "genToastDone", { count: newFrameCount }));
        } finally {
            setRefineProgress(null);
        }
    }, [updateProject, t]);

    const handleSmartGenerate = useCallback(async (options?: import("@/lib/storyboardAnalysis").StoryboardGenerationOptions) => {
        if (!currentProject?.id) return;
        const projectId = currentProject.id;
        const scriptText = (currentProject as any).originalText || (currentProject as any).original_text || "";
        if (!scriptText.trim()) {
            toast.warning(t("genToastNoScript"));
            return;
        }
        setGenerating(true);
        setAnalysisProgress(null);
        setBannerState("phase1");
        try {
            const result = await api.analyzeStoryboardPreview(projectId, scriptText, (completed, total) => {
                setAnalysisProgress({ completed, total });
            }, options);
            if (useProjectStore.getState().currentProject?.id !== projectId) return;
            if (options?.mode === "plan" && result.lineage.storyboard_mode !== "plan") {
                throw new Error("Director plan conversion returned the wrong storyboard mode");
            }
            if (options?.mode === "plan") {
                await applyStoryboardFrames(projectId, scriptText, result.frames, result.lineage,
                    currentProject.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v");
            } else {
                setStoryboardDraft(result.frames);
                setStoryboardDraftLineage(result.lineage);
                setStoryboardDraftText(scriptText);
                setStoryboardFeedback([]);
                setBannerState((currentProject.frames?.length ?? 0) > 0 ? "summary" : "idle");
            }
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err?.message || t("genToastErrUnknown");
            toast.error(`${t("genToastErr")}: ${String(detail).slice(0, 200)}`);
            setBannerState((currentProject.frames?.length ?? 0) > 0 ? "summary" : "idle");
        } finally {
            setGenerating(false);
            setAnalysisProgress(null);
        }
    }, [currentProject, applyStoryboardFrames, t]);

    const handleRefineStoryboardDraft = useCallback(async (instruction: string) => {
        if (!currentProject?.id || !storyboardDraft || !storyboardDraftText || !storyboardDraftLineage) return;
        const projectId = currentProject.id;
        const instructions = [...storyboardFeedback, instruction.trim()];
        setStoryboardDraftBusy(true);
        try {
            const revised = await api.refineStoryboardPreview(
                projectId, storyboardDraftText, storyboardDraft, instructions, storyboardDraftLineage,
            );
            if (useProjectStore.getState().currentProject?.id !== projectId) return;
            setStoryboardDraft(revised.frames);
            setStoryboardDraftLineage(revised.lineage);
            setStoryboardFeedback(instructions);
        } finally {
            setStoryboardDraftBusy(false);
        }
    }, [currentProject?.id, storyboardDraft, storyboardDraftText, storyboardDraftLineage, storyboardFeedback]);

    const handleApplyStoryboardDraft = useCallback(async () => {
        if (!currentProject?.id || !storyboardDraft || !storyboardDraftText || !storyboardDraftLineage) return;
        setStoryboardDraftBusy(true);
        try {
            await applyStoryboardFrames(currentProject.id, storyboardDraftText, storyboardDraft, storyboardDraftLineage,
                currentProject.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v");
            setStoryboardDraft(null);
            setStoryboardDraftLineage(null);
            setStoryboardDraftText("");
            setStoryboardFeedback([]);
        } finally {
            setStoryboardDraftBusy(false);
        }
    }, [currentProject, storyboardDraft, storyboardDraftText, storyboardDraftLineage, applyStoryboardFrames]);

    const handleDiscardStoryboardDraft = useCallback(() => {
        if (storyboardDraftBusy) return;
        setStoryboardDraft(null);
        setStoryboardDraftLineage(null);
        setStoryboardDraftText("");
        setStoryboardFeedback([]);
    }, [storyboardDraftBusy]);

    const handleInitializeFrame = useCallback(async (frameId: string) => {
        if (!currentProject?.id) return;
        try {
            await frameEdits.flush();
            const initialized = await api.initializeSingleFrame(currentProject.id, frameId);
            const updated = await api.getProject(currentProject.id);
            if (updated?.frames) {
                updateProject(currentProject.id, { frames: updated.frames });
                const defaultMode = currentProject.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v";
                const videoTasks: any[] = (updated as any).video_tasks ?? [];
                setShots(updated.frames.map((frame: any) => frameToShotNode(frame, videoTasks, defaultMode)));
            }
            toast.success(t(initialized.rich_refinement_candidate ? "initializeDoneToast" : "initializeNoMissing"));
        } catch (err) {
            toast.error(t("refineFailedToast"));
            debugLog.warn("Studio", "single frame initialization failed", err);
        }
    }, [currentProject, frameEdits, updateProject]);

    const handleRichRefinement = useCallback(async (frameId: string, candidateId: string, selectedFields?: string[]) => {
        if (!currentProject?.id || richRefinementBusyFrameId) return;
        const projectId = currentProject.id;
        setRichRefinementBusyFrameId(frameId);
        try {
            await frameEdits.flush();
            const updated = selectedFields
                ? await api.applyRichRefinement(projectId, frameId, candidateId, selectedFields)
                : await api.discardRichRefinement(projectId, frameId, candidateId);
            if (useProjectStore.getState().currentProject?.id !== projectId) return;
            updateProject(projectId, updated);
            const defaultMode = updated.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v";
            setShots(updated.frames.map((frame: any) => frameToShotNode(frame, updated.video_tasks ?? [], defaultMode)));
            toast.success(selectedFields ? "已应用所选分镜字段" : "已丢弃分镜细化建议");
        } catch (error) {
            debugLog.warn("Studio", "Rich refinement review failed", error);
            toast.error("操作失败，请重试；若镜头或素材已变化，请重新细化");
        } finally {
            setRichRefinementBusyFrameId(null);
        }
    }, [currentProject?.id, frameEdits, richRefinementBusyFrameId, updateProject]);

    // Delete a shot
    const deleteShot = useCallback(async (index: number) => {
        const target = shots[index];
        if (!target) return;
        setShots(prev => prev.filter((_, i) => i !== index));
        setExpandedShots(prev => {
            if (!prev.has(target.id)) return prev;
            const next = new Set(prev);
            next.delete(target.id);
            return next;
        });
        if (!currentProject?.id) return;
        // Synthetic id never reached backend → nothing to delete remotely.
        if (target.id.startsWith("shot_")) return;
        try {
            const resp = await crudApi.deleteFrame(currentProject.id, target.id);
            const frames = Array.isArray(resp?.frames) ? resp.frames : null;
            if (frames) updateProject(currentProject.id, { frames });
        } catch (err) {
            debugLog.warn("Studio", "deleteShot backend persist failed", err);
        }
    }, [shots, currentProject, updateProject]);

    // Move shot up/down
    const moveShot = useCallback(async (index: number, direction: "up" | "down") => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= shots.length) return;
        const updated = [...shots];
        [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];
        setShots(updated);
        if (!currentProject?.id) return;
        const ids = updated.map(s => s.id);
        // Reorder requires every id to be backed on backend — if any
        // are still synthetic (createFrame in-flight), defer; the next
        // move after createFrame settles will reconcile.
        if (ids.some(id => id.startsWith("shot_"))) return;
        try {
            const resp = await crudApi.reorderFrames(currentProject.id, ids);
            const frames = Array.isArray(resp?.frames) ? resp.frames : null;
            if (frames) updateProject(currentProject.id, { frames });
        } catch (err) {
            debugLog.warn("Studio", "moveShot backend persist failed", err);
        }
    }, [shots, currentProject, updateProject]);

    // Duplicate a shot
    const duplicateShot = useCallback(async (index: number) => {
        const source = shots[index];
        if (!source) return;
        const synthId = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newShot: ShotNode = {
            ...source,
            id: synthId,
            // Generated artifacts don't carry over; user duplicates
            // the *intent* of the shot, not the output.
            videoUrl: undefined,
            videoTaskId: undefined,
            videoStatus: undefined,
            t2iImageUrl: undefined,
            t2iTaskId: undefined,
            t2iStatus: undefined,
        };
        setShots(prev => {
            const updated = [...prev];
            updated.splice(index + 1, 0, newShot);
            return updated;
        });
        setExpandedShots(prev => {
            const next = new Set(prev);
            next.add(synthId);
            return next;
        });
        if (!currentProject?.id) return;
        // Source itself isn't on backend yet — best-effort: skip remote
        // copy, the next workbench/prompt write will materialize it.
        if (source.id.startsWith("shot_")) return;
        try {
            const resp = await crudApi.copyFrame(currentProject.id, source.id, index + 1);
            const frames = Array.isArray(resp?.frames) ? resp.frames : null;
            const realFrame = frames?.[index + 1];
            if (realFrame?.id) {
                setShots(prev => prev.map(s => s.id === synthId ? { ...s, id: realFrame.id } : s));
                setExpandedShots(prev => {
                    if (!prev.has(synthId)) return prev;
                    const next = new Set(prev);
                    next.delete(synthId);
                    next.add(realFrame.id);
                    return next;
                });
            }
            if (frames) updateProject(currentProject.id, { frames });
        } catch (err) {
            debugLog.warn("Studio", "duplicateShot backend persist failed", err);
        }
    }, [shots, currentProject, updateProject]);

    // Update shot prompt — local immediate + debounced backend write
    const updatePrompt = useCallback((index: number, prompt: string, optimized?: boolean) => {
        setShots(prev => prev.map((s, i) => {
            if (i !== index) return s;
            persistFrameEdit(s.id, { action_description: prompt,
                workbench_prompt_is_optimized: optimized ?? s.promptIsOptimized ?? false });
            return { ...s, prompt, promptIsOptimized: optimized ?? s.promptIsOptimized };
        }));
    }, [persistFrameEdit]);

    const setVideoMode = useCallback((index: number, mode: "t2v" | "i2v" | "first_last_frame" | "r2v") => {
        setShots(prev => prev.map((s, i) => {
            if (i !== index) return s;
            const tabMode = mode === "r2v" ? "direct_r2v" : "t2i_i2v";
            persistWorkbench(s.id, { workbench_tab_mode: tabMode, video_generation_mode: mode });
            return { ...s, videoMode: mode, tabMode };
        }));
    }, [persistWorkbench]);

    // Structured edits update the visible body and join the ordered frame save.
    const handleUpdateField = useCallback((index: number, field: string, value: string | number | null) => {
        setShots(prev => prev.map((s, i) => {
            if (i !== index) return s;
            if (field === "duration") return { ...s, duration: typeof value === "number" ? value : null };
            if (field === "lastFrameUrl") return { ...s, lastFrameUrl: typeof value === "string" ? value : undefined };
            if (field === "shotSize") return { ...s, shotSize: typeof value === "string" ? value : null };
            if (field === "cameraAngle") return { ...s, cameraAngle: typeof value === "string" ? value : null };
            if (field === "cameraMovement") {
                const desc = typeof value === "string" ? value : "固定镜头";
                return {
                    ...s,
                    cameraMovementStructured: {
                        primary: desc,
                        speed: s.cameraMovementStructured?.speed ?? "normal",
                        description: desc,
                        secondary: s.cameraMovementStructured?.secondary ?? null,
                    },
                };
            }
            if (field === "transitionHint") return { ...s, transitionHint: typeof value === "string" ? value : null };
            if (field === "stylePromptOverride" || field === "lightingOverride") {
                const next = editShotSettings(s, field, typeof value === "string" ? value : null, displayedStyle.positivePrompt);
                persistFrameEdit(s.id, {
                    style_prompt_override: next.stylePromptOverride ?? "",
                    lighting_override: next.lightingOverride ?? "",
                    ...(next.promptIsOptimized ? { action_description: next.prompt, workbench_prompt_is_optimized: true } : {}),
                });
                return next;
            }
            if (field === "negativePromptOverride") return { ...s, negativePromptOverride: typeof value === "string" ? value : null };
            return s;
        }));
        if (field === "stylePromptOverride" || field === "lightingOverride") return;
        const shotId = shots[index]?.id;
        if (!shotId) return;
        const backendField: Record<string, any> = {};
        if (field === "duration") backendField.duration = typeof value === "number" ? value : undefined;
        if (field === "shotSize") backendField.shot_size = typeof value === "string" ? value : undefined;
        if (field === "cameraAngle") backendField.camera_angle = typeof value === "string" ? value : undefined;
        if (field === "cameraMovement") backendField.camera_movement_description = typeof value === "string" ? value : undefined;
        if (field === "transitionHint") backendField.transition_hint = typeof value === "string" ? value : undefined;
        if (field === "negativePromptOverride") backendField.negative_prompt_override = typeof value === "string" ? value : undefined;
        persistFrameEdit(shotId, backendField);
    }, [shots, persistFrameEdit, displayedStyle.positivePrompt]);

    // Duration editor config — derived from active R2V model's catalog entry
    const durationEditorCfg = useMemo(() => {
        const r2vModel = VIDEO_R2V_MODELS.find(m => m.id === videoConfig.r2vModel);
        const dc = r2vModel?.duration;
        if (!dc) return { min: 3, max: 15, step: 1 };
        if (dc.type === "slider") return { min: dc.min, max: dc.max, step: dc.step };
        if (dc.type === "buttons") return { min: Math.min(...dc.options), max: Math.max(...dc.options), step: 1 };
        return { min: dc.value, max: dc.value, step: 1 };
    }, [videoConfig.r2vModel]);

    const referenceAssets = useMemo<ReferenceAsset[]>(() =>
        buildReferenceAssets(assetIndex, characters, scenes, props),
    [assetIndex, characters, scenes, props]);

    const loadShotReferences = useCallback(async (shot: Pick<ShotNode, "id" | "prompt" | "referenceVariantIds">) => {
        if (!currentProject) return null;
        try {
            const fresh = await refreshReferenceSubmission(
                currentProject.id, shot.prompt, shot.referenceVariantIds ?? {}, api.getProjectAssetReferenceIndex,
            );
            // A slow response from the previous project must not populate the
            // current editor or start a task after the user switched projects.
            if (useProjectStore.getState().currentProject?.id !== currentProject.id) return null;
            setIndexedProject({ projectId: currentProject.id, assets: fresh.index });
            return fresh.submission;
        } catch (error) {
            if (useProjectStore.getState().currentProject?.id !== currentProject.id) return null;
            debugLog.error("Studio", "Asset index verification failed", error);
            const message = t("assetReferencesUnavailable");
            setShotErrors(prev => ({ ...prev, [shot.id]: message }));
            toast.warning(message);
            return null;
        }
    }, [currentProject, t]);

    const resolveShotReferences = useCallback((shot: Pick<ShotNode, "prompt" | "referenceVariantIds">) =>
        resolveReferenceSubmission(shot.prompt, referenceAssets, shot.referenceVariantIds),
    [referenceAssets]);

    // Kept as the URL-only facade used by previews and polish calls.
    const parseAssetTags = useCallback((prompt: string, selections?: Record<string, string[]>): string[] =>
        resolveReferenceSubmission(prompt, referenceAssets, selections).urls,
    [referenceAssets]);

    // Generate T2I image for a shot (t2i_i2v mode stage 1)
    const generateT2I = useCallback(async (index: number, slot: "first" | "last" = "first") => {
        const shot = shots[index];
        if (!currentProject || !shot.prompt.trim()) return;
        try {
            const style = await loadGenerationStyle();
            const frame = currentProject.frames?.find((item: any) => item.id === shot.id);
            const reviewedImagePrompt = frame?.image_prompt_en?.trim();
            const imageDraft = reviewedImagePrompt || frame?.image_prompt || frame?.visual_description || frame?.action_description || shot.prompt;
            const draftStyle = reviewedImagePrompt ? "" : resolveStylePrompt(
                style.positivePrompt,
                shot.stylePromptOverride,
                shot.lightingOverride,
            );
            const cleanedPrompt = [draftStyle, imageDraft].filter(Boolean).join("\n")
                .replace(/\[(?:character\d+|character|scene|prop):[^\]]+\]/g, "")
                .replace(/\s+/g, " ")
                .trim();
            const negativePrompt = resolveNegativePrompt(
                style.negativePrompt,
                "",
                shot.negativePromptOverride,
            );
            const projected = await api.previewFrameCandidate(currentProject.id, shot.id, cleanedPrompt, negativePrompt, slot);
            setPendingCandidate({
                projectId: currentProject.id, frameId: shot.id, slot,
                preview: {
                    prompt: projected.prompt, negativePrompt: projected.negative_prompt,
                    contextToken: projected.context_token, batchSize: 1, referenceCount: null,
                    model: projected.model, aspectRatio: projected.aspect_ratio,
                    sourceLabel: [slot === "first" ? "首帧" : "尾帧", projected.source_label].filter(Boolean).join(" · "),
                    referenceLabels: projected.reference_asset_labels,
                    polishReview: projected.polish_review ?? undefined,
                },
            });
        } catch (error) {
            debugLog.error("Studio", "Failed to preview shot candidate:", error);
            toast.error("无法预览生成输入", { body: String((error as Error)?.message || "请重试") });
        }
    }, [shots, currentProject, loadGenerationStyle]);

    const confirmT2I = useCallback(async () => {
        const pending = pendingCandidate;
        if (!pending || candidateRenderBusyRef.current) return;
        if (currentProject?.id !== pending.projectId) {
            setPendingCandidate(null);
            toast.warning("项目已切换，请重新预览生成输入");
            return;
        }
        candidateRenderBusyRef.current = true;
        setPendingCandidate(null);
        const { projectId, frameId, slot, preview } = pending;
        setShots(prev => prev.map((s) =>
            s.id === frameId ? (slot === "first"
                ? { ...s, t2iStatus: "pending" }
                : { ...s, lastFrameStatus: "pending" }) : s
        ));
        try {
            const result = await api.renderFrameCandidate(
                projectId, frameId, preview.prompt, preview.negativePrompt, preview.contextToken,
            );
            if (!result?.image_url) throw new Error("候选生图没有返回图片");

            const imageUrl = result.image_url;
            setShots(prev => prev.map((s) => {
                if (s.id !== frameId) return s;
                if (slot === "last") {
                    const urls = [...(s.lastFrameImageUrls ?? []), imageUrl].slice(-10);
                    const selected = urls.length - 1;
                    persistWorkbench(s.id, { last_frame_image_urls: urls, last_frame_selected_index: selected });
                    return { ...s, lastFrameImageUrls: urls, lastFrameSelectedIndex: selected, lastFrameUrl: imageUrl, lastFrameStatus: "completed" };
                }
                const updated = appendT2IImage({ ...s, t2iStatus: "completed" }, imageUrl);
                persistWorkbench(s.id, {
                    t2i_image_urls: updated.t2iImageUrls ?? [],
                    t2i_selected_index: updated.t2iSelectedIndex ?? 0,
                });
                return updated;
            }));
        } catch (error) {
            debugLog.error("Studio", "Failed to generate T2I for shot:", error);
            toast.error("候选图片生成失败", { body: String((error as Error)?.message || "请重新预览后重试") });
            setShots(prev => prev.map((s) =>
                s.id === frameId ? (slot === "first"
                    ? { ...s, t2iStatus: "failed" }
                    : { ...s, lastFrameStatus: "failed" }) : s
            ));
        } finally {
            candidateRenderBusyRef.current = false;
        }
    }, [pendingCandidate, currentProject?.id, persistWorkbench]);

    // Batch-aware generation. The user's "抽卡" mental model: one
    // click of Generate ×N fires N independent createVideoTask calls
    // in parallel (each becomes its own VideoTask record on the
    // backend). All N task ids get appended to the shot's per-tab
    // bucket so the CandidatesSection can render them as one batch.
    // Refactored from the single-task generateVideo to support both
    // R2V and I2V paths; falls back to N=1 if count is undefined.
    const generateVideoBatch = useCallback(async (
        index: number,
        count: number,
        params?: Partial<ParamsState>,
    ) => {
        const shot = shots[index];
        if (!currentProject || !shot?.prompt.trim()) return;
        const tabMode = shot.tabMode;
        const videoInput = resolveShotVideoInput(shot);
        if (videoInput.error || (videoInput.mode === "r2v" && tabMode !== "direct_r2v")
            || (videoInput.mode !== "r2v" && tabMode === "direct_r2v")) {
            const message = videoInput.error || "视频模式与当前工作区不一致，请重新选择视频模式。";
            setShotErrors(prev => ({ ...prev, [shot.id]: message }));
            toast.warning(message);
            return;
        }
        const effectiveCount = Math.max(1, Math.min(6, count || 1));
        const requestedModelId = params?.model ?? (tabMode === "direct_r2v"
            ? videoConfig.r2vModel
            : videoConfig.model);
        const generateAudio = storyboardGeneratedAudio(
            requestedModelId,
            params?.audio ?? storyboardAudioChoice(shot.generateAudio, videoConfig.audio),
        );
        const referenceSubmission = tabMode === "direct_r2v"
            ? await loadShotReferences(shot) : resolveShotReferences(shot);
        if (!referenceSubmission) return;
        if (tabMode === "direct_r2v") {
            const frame = currentProject.frames.find((item: any) => item.id === shot.id);
            const message = characterUseReferenceError(
                (frame?.character_use_ids || {}) as Record<string, string>,
                currentProject.episode_character_uses || [], referenceSubmission.groups,
            );
            if (message) {
                setShotErrors((previous) => ({ ...previous, [shot.id]: message }));
                toast.warning(message);
                return;
            }
        }
        const requestedDuration = params?.duration ?? videoConfig.duration;
        const durationConfig = [...VIDEO_I2V_MODELS, ...VIDEO_R2V_MODELS]
            .find(model => model.id === requestedModelId)?.duration;
        // Storyboard timing may contain sub-four-second shots, while UniArt
        // Seedance/H3 only accept provider durations beginning at four seconds.
        // Preserve the authored shot timing and normalize only the generation
        // request so a valid storyboard does not become a rejected task.
        const generationDuration = durationConfig?.type === "slider"
            ? Math.max(durationConfig.min, Math.min(durationConfig.max, requestedDuration))
            : durationConfig?.type === "fixed"
                ? durationConfig.value
                : durationConfig?.type === "buttons"
                    ? (durationConfig.options.includes(requestedDuration)
                        ? requestedDuration
                        : durationConfig.default)
                    : requestedDuration;

        // Pre-flight: R2V tab needs reference inputs. Without them
        // the backend rejects with 400 anyway, but historically the
        // task would queue, fail mid-generation, and the user'd see
        // "排队中..." until the failure surfaced. Cheaper to validate
        // here and show inline error in the ParamsSection.
        if (tabMode === "direct_r2v") {
            const refs = referenceSubmission.urls;
            if (refs.length === 0 || referenceSubmission.unresolvedNames.length > 0) {
                const unresolved = referenceSubmission.unresolvedNames;
                let errMsg: string;
                if (unresolved.length > 0) {
                    errMsg = t("unresolvedRefImages", { refs: unresolved.join("、") });
                } else {
                    const r2vModelId = params?.model ?? videoConfig.r2vModel;
                    const r2vModel = VIDEO_R2V_MODELS.find(m => m.id === r2vModelId);
                    const modelLabel = r2vModel?.name ?? r2vModelId;
                    errMsg = missingRefsMessage(modelLabel);
                }
                setShotErrors(prev => ({ ...prev, [shot.id]: errMsg }));
                toast.warning(errMsg);
                return;
            }
            if (referenceSubmission.invalidVariantIds.length > 0) {
                const errMsg = t("invalidProductViews");
                setShotErrors(prev => ({ ...prev, [shot.id]: errMsg }));
                toast.warning(errMsg);
                return;
            }
            if (requestedModelId.toLowerCase().includes("minimax-h3") && refs.length > H3_MAX_REFERENCE_IMAGES) {
                const errMsg = t("tooManyH3References", { count: refs.length, max: H3_MAX_REFERENCE_IMAGES });
                setShotErrors(prev => ({ ...prev, [shot.id]: errMsg }));
                toast.warning(errMsg);
                return;
            }
        }

        if (!videoModelSupportsMode(requestedModelId, videoInput.mode)) {
            const message = "当前模型不支持所选视频模式，请选择兼容模型。";
            setShotErrors(prev => ({ ...prev, [shot.id]: message }));
            toast.warning(message);
            return;
        }

        // Per-shot submission lockout (Issue 17). The earlier in-flight guard
        // (`shot.videoStatus === "pending"|"processing"`) had a false positive
        // problem: when a shot has multiple tasks (batch ×4), one fails + others
        // still processing, retrying the failed one was BLOCKED by the others'
        // status. Replace with a 500ms debounce on the SHOT specifically — that
        // catches double-clicks / strict-mode double-fires without entangling
        // status semantics.
        if (submittingShotsRef.current.has(shot.id)) {
            debugLog.warn("Studio", "generateVideoBatch: refused — same shot submitted < 500ms ago");
            return;
        }
        submittingShotsRef.current.add(shot.id);
        window.setTimeout(() => submittingShotsRef.current.delete(shot.id), 500);
        // Clear any prior error once this attempt is valid; success
        // path or backend-side rejection will overwrite if needed.
        setShotErrors(prev => {
            if (!prev[shot.id]) return prev;
            const next = { ...prev };
            delete next[shot.id];
            return next;
        });

        setShots(prev => prev.map((s, i) =>
            i === index ? { ...s, videoStatus: "pending" } : s
        ));

        try {
            const style = await loadGenerationStyle();
            const basePromptText = buildGenerationPrompt(
                shot, generateAudio, requestedModelId, style.positivePrompt,
            );
            const effectiveNegativePrompt = resolveNegativePrompt(
                style.negativePrompt,
                params?.negativePrompt ?? videoConfig.negativePrompt,
                shot.negativePromptOverride,
            );
            // Build a per-call factory so the batch fires N parallel
            // requests through Promise.all — fail-fast on any one
            // failure leaves the others untouched on the backend (the
            // BG-task wrapper handles their lifecycle independently).
            const createOne = async (): Promise<string | null> => {
                if (tabMode === "direct_r2v") {
                    const referenceUrls = referenceSubmission.urls;
                    const explicitR2v = params?.model ?? videoConfig.r2vModel;
                    const explicitOk = VIDEO_R2V_MODELS.some(m => m.id === explicitR2v);
                    const routeModelId = explicitOk
                        ? explicitR2v
                        : getR2vRouteModelId(videoConfig.model);
                    const imageBased = isR2vImageBased(routeModelId);
                    const promptText = routeModelId.toLowerCase().includes("minimax-h3")
                        ? bindH3MultiReferencePrompt(basePromptText, referenceSubmission.groups)
                        : basePromptText;
                    const tasks = await api.createVideoTask(
                        currentProject.id,
                        "",
                        promptText,
                        generationDuration,
                        params?.seed,
                        params?.resolution ?? videoConfig.resolution,
                        generateAudio,
                        "",
                        params?.promptExtend ?? videoConfig.promptExtend,
                        effectiveNegativePrompt,
                        1,
                        routeModelId,
                        shot.id,
                        params?.shotType ?? "multi",
                        "r2v",
                        !imageBased ? referenceUrls : undefined,
                        undefined, undefined, undefined,
                        undefined, undefined,
                        imageBased ? referenceUrls : undefined,
                        params?.ratio,
                        tabMode,
                        params?.watermark,
                        shot.poseReferenceVariantIds,
                        shot.directorSnapshotMediaId ?? undefined,
                    );
                    const task = Array.isArray(tasks) ? tasks[0] : tasks;
                    return task?.id ?? null;
                }
                // I2V branch — same defensive check on the model.
                const i2vModelId = params?.model ?? videoConfig.model;
                const i2vModelOk = VIDEO_I2V_MODELS.some(m => m.id === i2vModelId);
                if (!i2vModelOk) {
                    debugLog.warn("Studio", `Refusing I2V submission with non-I2V model "${i2vModelId}".`);
                    return null;
                }
                const imageUrl = videoInput.firstFrameUrl;
                const tasks = await api.createVideoTask(
                    currentProject.id,
                    imageUrl,
                    basePromptText,
                    generationDuration,
                    params?.seed,
                    params?.resolution ?? videoConfig.resolution,
                    generateAudio,
                    "",
                    params?.promptExtend ?? videoConfig.promptExtend,
                    effectiveNegativePrompt,
                    1,
                    i2vModelId,
                    shot.id,
                    params?.shotType ?? "multi",
                    videoInput.mode,
                    undefined,
                    params?.mode ?? videoConfig.mode,
                    params?.sound ?? videoConfig.sound,
                    params?.cfgScale ?? videoConfig.cfgScale,
                    params?.viduAudio ?? videoConfig.viduAudio,
                    params?.movementAmplitude ?? videoConfig.movementAmplitude,
                    undefined,
                    undefined,
                    tabMode,
                    params?.watermark,
                    shot.poseReferenceVariantIds,
                    shot.directorSnapshotMediaId ?? undefined,
                    videoInput.mode === "first_last_frame" ? videoInput.lastFrameUrl : undefined,
                    videoInput.mode === "first_last_frame" ? shot.lastFrameMediaId : undefined,
                );
                const task = Array.isArray(tasks) ? tasks[0] : tasks;
                return task?.id ?? null;
            };

            const taskIds = (await Promise.all(
                Array.from({ length: effectiveCount }, createOne),
            )).filter((id): id is string => !!id);

            if (taskIds.length > 0) {
                setShotErrors(prev => {
                    if (!prev[shot.id]) return prev;
                    const next = { ...prev };
                    delete next[shot.id];
                    return next;
                });
                setShots(prev => prev.map((s, i) => {
                    if (i !== index) return s;
                    // Mirror the latest task id on the legacy single
                    // field so the ShotCard preview spinner / cancel
                    // CTA keep working. The candidates panel reads
                    // from project.video_tasks (filtered by
                    // frame_id + workbench_tab), so the per-tab id
                    // bucket on the shot is no longer needed.
                    return {
                        ...s,
                        videoTaskId: taskIds[taskIds.length - 1],
                        videoStatus: "processing" as const,
                    };
                }));
            } else {
                toast.error(t("videoGenSubmitFailedToast"));
                setShots(prev => prev.map((s, i) =>
                    i === index ? { ...s, videoStatus: "failed" as const } : s
                ));
            }
        } catch (error: any) {
            debugLog.error("Studio", "Batch generate failed for shot:", error);
            const status = error?.response?.status;
            const detail = error?.response?.data?.detail || error?.message || t("unknownErrorFallback");
            if (status === 400 && typeof detail === "string") {
                setShotErrors(prev => ({ ...prev, [shot.id]: detail }));
            }
            toast.error(t("videoGenFailedToast", { detail: String(detail).slice(0, 150) }));
            setShots(prev => prev.map((s, i) =>
                i === index ? { ...s, videoStatus: "failed" as const } : s
            ));
        }
    }, [shots, currentProject, videoConfig, resolveShotReferences, loadShotReferences, missingRefsMessage, t, loadGenerationStyle]);

    // Project-level task refresh: when any task on any shot is in
    // flight, refetch the whole project every 5s. The candidates
    // panel + queue read from currentProject.video_tasks for canonical
    // state. Cheap because it's just a GET; cancels when nothing is
    // in flight. This is independent of the per-shot poll above (the
    // per-shot poll updates shot.videoStatus / videoUrl which drives
    // the ShotCard preview; the project refresh fills in candidate
    // metadata like is_starred / label / error / final video_url).
    useEffect(() => {
        if (!currentProject?.id) return;
        const allTasks: any[] = (currentProject as any).video_tasks ?? [];
        const anyInFlight = allTasks.some(
            (t) => t.status === "pending" || t.status === "processing",
        );
        // Also poll if any shot's locally-tracked videoTaskId is not
        // yet reflected in the project record (closes the just-created
        // window). With the Phase-2 derive-from-tasks model, we only
        // care about the legacy single-id mirror on the shot.
        const localInFlight = shots.some((s) => {
            const id = s.videoTaskId;
            if (!id) return false;
            const t = allTasks.find((tt) => tt.id === id);
            return !t || t.status === "pending" || t.status === "processing";
        });
        if (!anyInFlight && !localInFlight) return;
        const projectId = currentProject.id;
        const id = window.setInterval(async () => {
            try {
                const fresh = await api.getProject(projectId);
                updateProject(projectId, fresh);
            } catch {
                /* swallow — network blips are fine, next tick retries */
            }
        }, 5000);
        return () => window.clearInterval(id);
    }, [currentProject?.id, (currentProject as any)?.video_tasks, shots, updateProject]);

    // Poll for task completion (both T2I and video)
    useEffect(() => {
        const processingShots = shots.filter(s =>
            (s.videoTaskId && (s.videoStatus === "processing" || s.videoStatus === "pending")) ||
            (s.t2iTaskId && (s.t2iStatus === "processing" || s.t2iStatus === "pending"))
            || s.lastFrameTaskId
        );
        if (processingShots.length === 0) return;

        const interval = setInterval(async () => {
            for (const shot of processingShots) {
                // Poll video task
                if (shot.videoTaskId && (shot.videoStatus === "processing" || shot.videoStatus === "pending")) {
                    try {
                        const status = await api.getTaskStatus(shot.videoTaskId);
                        if (status.status === "completed" && status.video_url) {
                            setShots(prev => prev.map(s =>
                                s.id === shot.id ? { ...s, videoStatus: "completed", videoUrl: status.video_url } : s
                            ));
                            // Persist as the frame's active take so reloads, refines, and
                            // cross-device opens see the same hero video. Backend skips
                            // the update when the user has pinned a take. Fire-and-forget
                            // — UI already updated above, so failure here is non-fatal.
                            // Sync shot.videoUrl from backend response too: if a sibling
                            // task in the same batch completed first (so backend picked
                            // that one as active) the hero stays in sync.
                            const projectId = currentProject?.id;
                            if (projectId) {
                                api.autoSelectLatestVideo(projectId, shot.id)
                                    .then(updated => {
                                        updateProject(projectId, { frames: updated.frames });
                                        const refreshed = updated.frames?.find((f: any) => f.id === shot.id);
                                        if (refreshed?.video_url) {
                                            setShots(prev => prev.map(s =>
                                                s.id === shot.id
                                                    ? { ...s, videoUrl: refreshed.video_url, isVideoPinned: Boolean(refreshed.is_video_pinned) }
                                                    : s
                                            ));
                                        }
                                    })
                                    .catch(err => debugLog.warn("Studio", "autoSelectLatestVideo failed:", err));
                            }
                        } else if (status.status === "failed") {
                            setShotErrors(prev => ({ ...prev, [shot.id]: status.error || t("genFailed") }));
                            setShots(prev => prev.map(s =>
                                s.id === shot.id ? { ...s, videoStatus: "failed" } : s
                            ));
                        }
                    } catch (error) {
                        debugLog.error("Studio", "Video poll failed for shot:", shot.id, error);
                    }
                }
                // Poll T2I task
                if (shot.t2iTaskId && (shot.t2iStatus === "processing" || shot.t2iStatus === "pending")) {
                    try {
                        const status = await api.getTaskStatus(shot.t2iTaskId);
                        if (status.status === "completed") {
                            const imageUrl = status.image_url || status.video_url || status.result_url;
                            if (imageUrl) {
                                setShots(prev => prev.map(s => {
                                    if (s.id !== shot.id) return s;
                                    const updated = appendT2IImage({ ...s, t2iStatus: "completed" }, imageUrl);
                                    persistWorkbench(s.id, {
                                        t2i_image_urls: updated.t2iImageUrls ?? [],
                                        t2i_selected_index: updated.t2iSelectedIndex ?? 0,
                                    });
                                    return updated;
                                }));
                            }
                        } else if (status.status === "failed") {
                            setShotErrors(prev => ({ ...prev, [shot.id]: status.error || t("genFailed") }));
                            setShots(prev => prev.map(s =>
                                s.id === shot.id ? { ...s, t2iStatus: "failed" } : s
                            ));
                        }
                    } catch (error) {
                        debugLog.error("Studio", "T2I poll failed for shot:", shot.id, error);
                    }
                }
                if (shot.lastFrameTaskId) {
                    try {
                        const status = await api.getTaskStatus(shot.lastFrameTaskId);
                        if (status.status === "completed") {
                            const imageUrl = status.image_url || status.result_url;
                            if (imageUrl) {
                                setShots(prev => prev.map(s => {
                                    if (s.id !== shot.id) return s;
                                    const urls = [...(s.lastFrameImageUrls ?? []), imageUrl].slice(-10);
                                    const selected = urls.length - 1;
                                    persistWorkbench(s.id, { last_frame_image_urls: urls, last_frame_selected_index: selected });
                                    return { ...s, lastFrameTaskId: undefined, lastFrameImageUrls: urls, lastFrameSelectedIndex: selected, lastFrameUrl: imageUrl };
                                }));
                            }
                        } else if (status.status === "failed") {
                            setShotErrors(prev => ({ ...prev, [shot.id]: status.error || t("genFailed") }));
                            setShots(prev => prev.map(s =>
                                s.id === shot.id ? { ...s, lastFrameTaskId: undefined } : s,
                            ));
                        }
                    } catch (error) {
                        debugLog.error("Studio", "Last frame poll failed for shot:", shot.id, error);
                    }
                }
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [shots, persistWorkbench]);

    // Insert asset tag from drawer into target shot
    const insertAssetFromDrawer = useCallback((type: string, name: string) => {
        const shotIndex = drawerState.targetShotIndex;
        if (shotIndex === null || shotIndex === undefined) return;

        const tag = `[${type}:${name}]`;
        const textarea = textareaRefs.current.get(shotIndex) ?? null;
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const currentPrompt = shots[shotIndex].prompt;
            const newPrompt = currentPrompt.slice(0, start) + tag + currentPrompt.slice(end);
            updatePrompt(shotIndex, newPrompt);
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + tag.length;
                textarea.focus();
            }, 0);
        } else {
            updatePrompt(shotIndex, shots[shotIndex].prompt + " " + tag);
        }
    }, [drawerState.targetShotIndex, shots, updatePrompt]);

    const toggleReferenceVariantForShot = useCallback((
        shotIndex: number,
        assetId: string,
        variantId: string,
        primaryVariantId?: string,
    ) => {
        const shot = shots[shotIndex];
        if (!shot) return;
        const currentMap = shot.referenceVariantIds ?? {};
        const current = currentMap[assetId]?.length
            ? currentMap[assetId]
            : (primaryVariantId ? [primaryVariantId] : []);
        const nextIds = current.includes(variantId)
            ? current.filter((id) => id !== variantId)
            : [...current, variantId];
        // Every referenced asset keeps at least one view. Removing the final
        // explicit view returns to its primary-image fallback.
        const nextMap = { ...currentMap };
        if (nextIds.length === 0) delete nextMap[assetId];
        else nextMap[assetId] = nextIds;
        const nextShot = { ...shot, referenceVariantIds: nextMap };
        const modelId = shot.videoModel ?? videoConfig.r2vModel;
        const referenceCount = resolveShotReferences(nextShot).urls.length;
        if (modelId.toLowerCase().includes("minimax-h3") && referenceCount > H3_MAX_REFERENCE_IMAGES) {
            toast.warning(t("tooManyH3References", { count: referenceCount, max: H3_MAX_REFERENCE_IMAGES }));
            return;
        }
        setShots(prev => prev.map((item, index) => index === shotIndex ? nextShot : item));
        persistWorkbench(shot.id, { workbench_reference_variant_ids: nextMap });
    }, [shots, videoConfig.r2vModel, resolveShotReferences, persistWorkbench, t]);

    const toggleReferenceVariant = useCallback((assetId: string, variantId: string, primaryVariantId?: string) => {
        const shotIndex = drawerState.targetShotIndex;
        if (shotIndex === null || shotIndex === undefined) return;
        toggleReferenceVariantForShot(shotIndex, assetId, variantId, primaryVariantId);
    }, [drawerState.targetShotIndex, toggleReferenceVariantForShot]);

    // Toolbar model display: surface the model the project's workflow
    // mode actually uses, not the I2V parent. R2V projects were
    // showing "wan2.7-i2v" while their generation actually went
    // through wan2.6-r2v / wan2.7-r2v — confusing and the source of
    // the "but I selected R2V" support thread.
    const isR2VWorkflow = (currentProject?.workflow_mode ?? "r2v") === "r2v";
    // ---- Project-level task derivations (drive Queue + Candidates) ----
    // We derive these via useMemo so per-render allocation is cheap and
    // children can rely on referentially-stable arrays (set-membership
    // tests in CompareModal etc. are correctness-sensitive).
    const allVideoTasks: VideoTask[] = useMemo(
        () => ((currentProject as any)?.video_tasks ?? []) as VideoTask[],
        [currentProject],
    );

    const tasksById = useMemo(() => {
        const map = new Map<string, VideoTask>();
        for (const t of allVideoTasks) map.set(t.id, t);
        return map;
    }, [allVideoTasks]);

    // Map shot.id → human label for the queue panel's frame column.
    const shotLabelByFrameId = useMemo(() => {
        const out: Record<string, string> = {};
        shots.forEach((s, i) => { out[s.id] = `Shot ${i + 1}`; });
        return out;
    }, [shots]);

    // In-flight aggregate count drives the TaskQueueButton badge.
    const inFlightTaskCount = useMemo(
        () => allVideoTasks.filter(t => t.status === "pending" || t.status === "processing").length,
        [allVideoTasks],
    );

    // Sync shot.videoStatus from project.video_tasks when the
    // project-level poll refreshes. Video task status is only visible
    // via project refresh (GET /tasks/ only covers asset tasks).
    useEffect(() => {
        if (!allVideoTasks.length) return;
        const autoSelectFrameIds: string[] = [];
        setShots(prev => {
            let changed = false;
            const next = prev.map(s => {
                if (!s.videoTaskId) return s;
                const task = allVideoTasks.find(t => t.id === s.videoTaskId);
                if (!task) return s;
                if (task.status === "completed" && s.videoStatus !== "completed") {
                    changed = true;
                    autoSelectFrameIds.push(s.id);
                    return { ...s, videoStatus: "completed" as const, videoUrl: (task as any).video_url };
                }
                if (task.status === "failed" && s.videoStatus !== "failed") {
                    changed = true;
                    return { ...s, videoStatus: "failed" as const };
                }
                return s;
            });
            return changed ? next : prev;
        });
        // Persist newly-completed videos as the frame's active take so the
        // hero survives reload / refine / cross-device opens. Backend skips
        // pinned frames; failures here are non-fatal (UI already updated).
        const projectId = currentProject?.id;
        if (projectId && autoSelectFrameIds.length > 0) {
            Promise.all(
                autoSelectFrameIds.map(frameId =>
                    api.autoSelectLatestVideo(projectId, frameId).catch(err => {
                        debugLog.warn("Studio", "autoSelectLatestVideo failed for frame:", frameId, err);
                        return null;
                    })
                )
            ).then(results => {
                // Use the last successful response's frames (all calls
                // converge on the same script state — last write wins).
                const last = results.filter(Boolean).pop() as any;
                if (last?.frames) {
                    updateProject(projectId, { frames: last.frames });
                    // Sync the hero on every auto-selected frame: backend may
                    // have picked a sibling take in the same batch, so the
                    // optimistic videoUrl set above could be stale by a hop.
                    setShots(prev => prev.map(s => {
                        if (!autoSelectFrameIds.includes(s.id)) return s;
                        const refreshed = last.frames.find((f: any) => f.id === s.id);
                        if (!refreshed?.video_url) return s;
                        return { ...s, videoUrl: refreshed.video_url, isVideoPinned: Boolean(refreshed.is_video_pinned) };
                    }));
                }
            });
        }
    }, [allVideoTasks, currentProject?.id, updateProject]);

    // Compare modal needs the actual VideoTask objects for the
    // currently-selected ids (in whatever order they were selected).
    const compareTasks = useMemo(() => {
        const out: VideoTask[] = [];
        Array.from(compareSelectedIds).forEach((id) => {
            const t = tasksById.get(id);
            if (t) out.push(t);
        });
        return out;
    }, [compareSelectedIds, tasksById]);

    // Per-shot candidate tasks — derived directly from the project-
    // level video_tasks. After Phase 2 persistence, each VideoTask
    // carries `frame_id` + `workbench_tab` so we can bucket without a
    // shot-side index. Pre-Phase-2 tasks lack `workbench_tab`; they
    // fall back to `generation_mode` so legacy records still group
    // correctly into the right tab.
    const tasksForShot = useCallback((shot: ShotNode): VideoTask[] => {
        return allVideoTasks.filter((t) => {
            if (t.frame_id !== shot.id) return false;
            if (t.workbench_tab != null) {
                return t.workbench_tab === shot.tabMode;
            }
            // Legacy fallback: i2v tasks belong in t2i_i2v, r2v in direct_r2v.
            if (shot.tabMode === "direct_r2v") return t.generation_mode === "r2v";
            return t.generation_mode !== "r2v"; // i2v + undefined → i2v tab
        });
    }, [allVideoTasks]);

    // Build a ParamsState from videoConfig + per-shot overrides.
    // Single source of truth strategy:
    //  - Per-shot overrides (shotCounts, shotSeeds) for params whose
    //    "right value" naturally differs by shot.
    //  - videoConfig for shared knobs the user typically picks once
    //    and uses across all shots in a project.
    const paramsStateForShot = useCallback((shot: ShotNode): ParamsState => {
        const isR2v = shot.tabMode === "direct_r2v";
        const videoMode = resolveShotVideoInput(shot).mode;
        const models = (isR2v ? VIDEO_R2V_MODELS : VIDEO_I2V_MODELS)
            .filter(model => videoModelSupportsMode(model.id, videoMode));
        const selected = shot.videoModel ?? (isR2v ? videoConfig.r2vModel : videoConfig.model);
        const modelId = models.some(model => model.id === selected)
            ? selected : preferredVideoModel(models, isR2v ? DEFAULT_R2V_MODEL_ID : DEFAULT_I2V_MODEL_ID);
        return {
            model: modelId,
            duration: shot.duration ?? videoConfig.duration,
            count: shotCounts[shot.id] ?? 1,
            // Per-shot seed override (Sweep G fix); undefined means
            // "random per generation".
            seed: shotSeeds[shot.id],
            resolution: videoConfig.resolution,
            ratio: videoConfig.ratio,
            negativePrompt: videoConfig.negativePrompt,
            promptExtend: videoConfig.promptExtend,
            cfgScale: videoConfig.cfgScale,
            mode: videoConfig.mode,
            movementAmplitude: videoConfig.movementAmplitude,
            audio: storyboardAudioChoice(shot.generateAudio, videoConfig.audio),
            sound: videoConfig.sound,
            viduAudio: videoConfig.viduAudio,
            watermark: videoConfig.watermark,
        };
    }, [videoConfig, shotCounts, shotSeeds]);

    // ParamsSection.onChange handler: per-shot overrides (count, seed)
    // go into their dedicated maps; everything else writes back to
    // the shared videoConfig (so the user's most-recent picks become
    // the new default for siblings). videoConfig is mirrored to
    // localStorage as a recovery cache only — the authoritative model
    // selection lives in project.model_settings, written via the
    // 生成设置 modal.
    const handleShotParamsChange = useCallback((shot: ShotNode, next: ParamsState) => {
        if ((shotCounts[shot.id] ?? 1) !== next.count) {
            persistWorkbench(shot.id, { workbench_generate_count: next.count });
        }
        setShotCounts(prev => ({ ...prev, [shot.id]: next.count }));
        setShots(prev => prev.map(item => item.id === shot.id ? {
            ...item,
            videoModel: next.model,
            generateAudio: next.audio === true,
        } : item));
        persistWorkbench(shot.id, {
            video_model: next.model,
            workbench_generate_audio: next.audio === true,
        });
        // Sync duration back to structured field (single source of truth)
        if (next.duration !== (shot.duration ?? videoConfig.duration)) {
            const idx = shots.findIndex(s => s.id === shot.id);
            if (idx >= 0) handleUpdateField(idx, "duration", next.duration);
        }
        // Seed: track per-shot. Undefined ↔ "random" — stored as
        // delete-from-map so the entry doesn't accrete forever.
        setShotSeeds(prev => {
            const wasSet = prev[shot.id] !== undefined;
            const isSet = next.seed !== undefined && !Number.isNaN(next.seed);
            if (!wasSet && !isSet) return prev;
            if (wasSet && !isSet) {
                const out = { ...prev };
                delete out[shot.id];
                return out;
            }
            if (prev[shot.id] === next.seed) return prev;
            return { ...prev, [shot.id]: next.seed };
        });
        const isR2v = shot.tabMode === "direct_r2v";
        const ls = typeof window !== "undefined" ? window.localStorage : null;
        setVideoConfig(prev => {
            const updated: VideoConfig = {
                ...prev,
                duration: next.duration,
                resolution: next.resolution ?? prev.resolution,
                ratio: next.ratio ?? prev.ratio,
                negativePrompt: next.negativePrompt ?? prev.negativePrompt,
                promptExtend: next.promptExtend ?? prev.promptExtend,
                cfgScale: next.cfgScale ?? prev.cfgScale,
                mode: next.mode ?? prev.mode,
                movementAmplitude: next.movementAmplitude ?? prev.movementAmplitude,
                audio: next.audio ?? false,
                sound: next.sound ?? prev.sound,
                viduAudio: next.viduAudio ?? prev.viduAudio,
                // Watermark — preserve undefined (means "model doesn't expose
                // it") so swapping to a non-watermark-supporting model clears it.
                watermark: next.watermark,
            };
            if (isR2v) {
                updated.r2vModel = next.model;
                ls?.setItem("storyboard-r2v-r2v-model", next.model);
            } else {
                updated.model = next.model;
                ls?.setItem("storyboard-r2v-model", next.model);
            }
            return updated;
        });
    }, [persistWorkbench, shotCounts]);

    // Annotate handlers wire CandidateThumb's star/label CTAs to the
    // backend PATCH endpoint. We refresh the project after each call
    // so the candidate cell re-renders with the new flag without
    // waiting for the 5s polling tick.
    const refreshProject = useCallback(async () => {
        if (!currentProject?.id) return;
        try {
            const fresh = await api.getProject(currentProject.id);
            updateProject(currentProject.id, fresh);
        } catch { /* swallow */ }
    }, [currentProject?.id, updateProject]);

    const handleToggleStar = useCallback(async (task: VideoTask, next: boolean) => {
        if (!currentProject?.id) return;
        try {
            await api.annotateVideoTask(currentProject.id, task.id, { is_starred: next });
            await refreshProject();
        } catch (err) {
            debugLog.error("Studio", "Failed to toggle star:", err);
        }
    }, [currentProject?.id, refreshProject]);

    // Manual pin: user explicitly chose this take as the frame's active
    // video. Backend sets is_video_pinned=true so subsequent auto-selects
    // (polling completion) skip this frame. Locally we update the shot's
    // videoUrl + videoStatus immediately so the hero swaps without waiting
    // for the project refresh round-trip.
    const handleSetActive = useCallback(async (frameId: string, task: VideoTask) => {
        if (!currentProject?.id) return;
        const taskVideoUrl = (task as any).video_url as string | undefined;
        setShots(prev => prev.map(s =>
            s.id === frameId
                ? { ...s, videoUrl: taskVideoUrl, videoStatus: "completed" as const, isVideoPinned: true }
                : s
        ));
        try {
            const updated = await api.selectVideo(currentProject.id, frameId, task.id);
            updateProject(currentProject.id, { frames: updated.frames });
        } catch (err) {
            debugLog.error("Studio", "Failed to set active take:", err);
        }
    }, [currentProject?.id, updateProject]);

    // Unpin: clear the manual pin so auto-select resumes on next
    // completion. Selected_video_id / video_url stay put — user keeps
    // seeing the current take until a newer one arrives.
    const handleUnpinVideo = useCallback(async (frameId: string) => {
        if (!currentProject?.id) return;
        setShots(prev => prev.map(s =>
            s.id === frameId ? { ...s, isVideoPinned: false } : s
        ));
        try {
            const updated = await api.unpinVideo(currentProject.id, frameId);
            updateProject(currentProject.id, { frames: updated.frames });
        } catch (err) {
            debugLog.error("Studio", "Failed to unpin video:", err);
        }
    }, [currentProject?.id, updateProject]);

    const handleSetLabel = useCallback(async (task: VideoTask, next: string | null) => {
        if (!currentProject?.id) return;
        try {
            if (next === null || next === "") {
                await api.annotateVideoTask(currentProject.id, task.id, { clear_label: true });
            } else {
                await api.annotateVideoTask(currentProject.id, task.id, { label: next });
            }
            await refreshProject();
        } catch (err) {
            debugLog.error("Studio", "Failed to set label:", err);
        }
    }, [currentProject?.id, refreshProject]);

    const handleCancelTask = useCallback(async (task: VideoTask) => {
        if (!currentProject?.id) return;
        try {
            await api.cancelVideoTask(currentProject.id, task.id);
            await refreshProject();
        } catch (err) {
            debugLog.error("Studio", "Failed to cancel task:", err);
        }
    }, [currentProject?.id, refreshProject]);

    // Retry = fire a fresh batch of 1 for the shot owning this task,
    // reusing the task's params as best-effort. After Phase 2 the
    // task→shot mapping is direct via task.frame_id; falls back to
    // current ParamsSection state if we can't find the owner.
    const handleRetryTask = useCallback(async (task: VideoTask) => {
        const ownerIdx = task.frame_id
            ? shots.findIndex((s) => s.id === task.frame_id)
            : -1;
        if (ownerIdx < 0) return;
        await generateVideoBatch(ownerIdx, 1);
    }, [shots, generateVideoBatch]);

    // Click on a candidate thumb: plain click = preview (open new
    // window for v1), shift-click = toggle compare-selection.
    const handleCandidateClick = useCallback(async (task: VideoTask, mods: { shift: boolean; meta: boolean }) => {
        if (mods.shift) {
            setCompareSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(task.id)) next.delete(task.id);
                else next.add(task.id);
                return next;
            });
            return;
        }
        const frame = currentProject?.frames?.find((f: any) => f.dubbed_video_task_id === task.id);
        const url = frame?.dubbed_video_url || task.video_url;
        if (url) {
            try {
                const fresh = frame?.dubbed_video_url
                    ? await resolveMediaDelivery(url)
                    : await resolveVideoTaskDelivery(task.project_id, task.id);
                window.open(fresh, "_blank", "noopener");
            } catch {
                toast.error("视频暂时无法访问，请刷新后重试");
            }
        }
    }, [currentProject]);

    // 复用此批参数: copy a batch's model + neg_prompt into videoConfig,
    // so the next Generate uses the same recipe. We don't change count
    // here — count remains the per-shot knob the user chose.
    const handleReuseBatchParams = useCallback((batch: BatchSummary) => {
        const first = batch.tasks[0];
        if (!first) return;
        setVideoConfig(prev => {
            const updated = { ...prev };
            // Decide which slot the batch's model lives in (I2V or R2V).
            if (VIDEO_R2V_MODELS.some(m => m.id === first.model)) {
                updated.r2vModel = first.model!;
            } else if (VIDEO_I2V_MODELS.some(m => m.id === first.model)) {
                updated.model = first.model!;
            }
            if (first.duration) updated.duration = first.duration;
            if (first.resolution) updated.resolution = first.resolution;
            if (first.negative_prompt !== undefined) updated.negativePrompt = first.negative_prompt;
            return updated;
        });
    }, []);

    // Queue's jump-to-shot: scroll the shot's wrapper into view AND
    // expand the shot panel + its sections (otherwise jumping to a
    // collapsed shot lands the user on a 1-line strip and they have
    // to expand manually).
    const handleJumpToShot = useCallback((frameId: string) => {
        setExpandedShots(prev => {
            if (prev.has(frameId)) return prev;
            const next = new Set(prev);
            next.add(frameId);
            return next;
        });
        // Force inner sections open too — feels right when arriving from
        // a queue task: you want to see Params + Candidates for that shot.
        overridePanelSectionState([frameId], ["params", "candidates"], true);
        // Scroll after the next paint so the newly-expanded body is
        // measured correctly. RAF is sufficient — we don't need the
        // full layout effect cycle.
        requestAnimationFrame(() => {
            const el = shotWrapperRefs.current.get(frameId);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }, []);

    // Active candidate URL resolver — many backend video URLs are
    // relative paths needing the asset prefix to render in <video>.
    const resolveAssetUrl = useCallback((u: string) => getAssetUrl(u), []);

    // In-flight shot count for trailing slot stat
    const totalInFlight = useMemo(
        () => Object.values(shotCounts).reduce((acc: number, c: any) => acc + (c?.processing ?? 0) + (c?.pending ?? 0), 0),
        [shotCounts],
    );

    return (
        // Layout v4: outer horizontal split. Custom page header belongs
        // to main column (not page-wide), so the right TaskQueuePanel can
        // be a true floor-to-ceiling sidebar with its own SidePanelHeader.
        <div className="h-full flex overflow-hidden relative">
        {pendingCandidate && <RenderPromptPreviewDialog
            preview={pendingCandidate.preview}
            onConfirm={confirmT2I}
            onClose={() => setPendingCandidate(null)}
        />}
        {/* Main column — pushed (compressed) when the queue panel opens
            so the queue doesn't overlay content. Bloom/grain now global in
            ProjectClient so the whole pipeline shares one atmosphere. */}
        <div className="relative z-10 flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Unified page header (shared StepPageHeader) */}
            <StepPageHeader
                stepNumber={4}
                englishName="STORYBOARD R2V"
                title={tStep("shotDesignTitle")}
                subtitle={tStep("shotDesignSubtitle")}
                pills={(
                    <>
                        {currentProject?.art_direction?.style_config?.name ? (
                            <StepPill label={t("artStyleLabel")} value={currentProject.art_direction.style_config.name} />
                        ) : null}
                        <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-glass-border bg-surface-inset px-2.5 py-1 font-mono text-[0.59375rem] text-text-secondary">
                            <span className="shrink-0 text-text-muted">{t("currentModel")}</span>
                            <select
                                aria-label={t("currentModel")}
                                value={isR2VWorkflow ? videoConfig.r2vModel : videoConfig.model}
                                onChange={(event) => {
                                    const value = event.target.value;
                                    setVideoConfig(prev => isR2VWorkflow ? { ...prev, r2vModel: value } : { ...prev, model: value });
                                }}
                                className="max-w-[13rem] truncate bg-transparent text-primary outline-none"
                            >
                                {(isR2VWorkflow ? VIDEO_R2V_MODELS : VIDEO_I2V_MODELS).map(model => (
                                    <option key={model.id} value={model.id}>{model.name}</option>
                                ))}
                            </select>
                        </span>
                    </>
                )}
                trailing={(
                    <>
                        <TaskQueueButton
                            inFlightCount={inFlightTaskCount}
                            open={queueOpen}
                            onToggle={() => setQueueOpen(v => !v)}
                        />
                        <button
                            type="button"
                            onClick={() => setGenDialogOpen(true)}
                            disabled={generating}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 font-sans text-[0.8125rem] font-semibold text-on-accent shadow-[var(--btn-pri-glow),inset_0_1.5px_0_rgba(255,255,255,0.14)] transition-all duration-fast ease-out-quart hover:bg-primary-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                        >
                            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                            <span>{generating ? (analysisProgress
                                ? `${t("genInFlight")} ${analysisProgress.completed}/${analysisProgress.total}`
                                : t("genInFlight")) : t("genShots")}</span>
                        </button>
                    </>
                )}
            />
            {/* Top Toolbar — mock-aligned: count on the left, expand/collapse pills on the right */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 shrink-0 sm:px-6">
                <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] tracking-[0.04em] text-text-secondary">
                        <span className="text-foreground font-medium">{shots.length}</span>
                        <span className="ml-1.5 uppercase">{shots.length === 1 ? t("shot") : t("shots")}</span>
                        {totalInFlight > 0 ? <span className="ml-2 text-status-processing-fg">· {totalInFlight} {t("inFlightShort")}</span> : null}
                    </span>
                    <motion.button
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => addShot(shots.length - 1)}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                        <Plus size={13} strokeWidth={2} />
                        {t("addShot")}
                    </motion.button>
                </div>
                {shots.length > 1 ? (
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            onClick={expandAllShots}
                            title={t("expandAll")}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-glass-border bg-transparent px-3.5 font-mono text-[13px] uppercase tracking-[0.06em] text-text-secondary transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                        >
                            <PanelBottomOpen size={12} strokeWidth={1.8} />
                            {t("expandAll")}
                        </button>
                        <button
                            type="button"
                            onClick={collapseAllShots}
                            title={t("collapseAll")}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-glass-border bg-transparent px-3.5 font-mono text-[13px] uppercase tracking-[0.06em] text-text-secondary transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                        >
                            <PanelBottomClose size={12} strokeWidth={1.8} />
                            {t("collapseAll")}
                        </button>
                    </div>
                ) : null}
            </div>

            <GenerationBanner
                state={bannerState}
                phase1Captions={PHASE1_CAPTIONS}
                refineProgress={refineProgress}
                dialogueProgress={dialogueProgress}
                summary={bannerSummary}
                onGenerateDialogue={handleBatchDialogue}
            />

            <div className="flex-1 overflow-y-auto px-5 pt-1.5 pb-10 space-y-5 sm:px-7">
                {shots.length === 0 && (
                    <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center px-6">
                        <div className="rounded-2xl border border-glass-border bg-glass p-8 max-w-lg">
                            <div className="mx-auto w-12 h-12 grid place-items-center rounded-full bg-primary/10 border border-primary/30 mb-4">
                                <Wand2 size={20} className="text-primary" />
                            </div>
                            <h3 className="text-display font-medium text-foreground">{t("emptyTitle")}</h3>
                            <p className="text-body-sm text-text-secondary mt-1.5 max-w-md mx-auto leading-relaxed">
                                {t("emptyBody")}
                            </p>
                            <div className="mt-5 flex items-center justify-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setGenDialogOpen(true)}
                                    disabled={generating}
                                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-primary text-white border border-primary/65 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14)] hover:bg-primary-hover disabled:opacity-40 transition-colors text-[0.8125rem] font-semibold"
                                >
                                    {generating ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                                    {generating ? (analysisProgress
                                        ? `${t("genInFlight")} ${analysisProgress.completed}/${analysisProgress.total}`
                                        : t("genInFlight")) : t("emptyCTA")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => addShot(-1)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-glass border border-glass-border text-text-secondary hover:text-foreground hover:bg-hover-bg transition-colors text-[0.75rem]"
                                >
                                    <Plus size={12} />
                                    {t("emptyManualAdd")}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {shots.map((shot, index) => {
                    const shotTasks = tasksForShot(shot);
                    const shotInFlight = shotTasks.filter(
                        (t) => t.status === "pending" || t.status === "processing",
                    ).length;
                    const paramsState = paramsStateForShot(shot);
                    const showFrameInputs = shot.videoMode === "first_last_frame" || (shot.videoMode ?? (shot.tabMode === "direct_r2v" ? "r2v" : "i2v")) === "i2v";
                    const projectFrames = currentProject?.frames ?? [];
                    const projectFrameIndex = projectFrames.findIndex((frame: any) => frame.id === shot.id);
                    const previousFrame = projectFrameIndex > 0 ? projectFrames[projectFrameIndex - 1] : null;
                    const previousSelectedVideo = previousFrame && (currentProject?.video_tasks ?? []).find((task: any) =>
                        task.id === previousFrame.selected_video_id
                        && task.frame_id === previousFrame.id
                        && task.status === "completed"
                        && task.video_url,
                    );
                    const modelList = (shot.tabMode === "direct_r2v" ? VIDEO_R2V_MODELS : VIDEO_I2V_MODELS)
                        .filter(model => videoModelSupportsMode(model.id, resolveShotVideoInput(shot).mode));
                    return (
                    /* Plain div (was motion.div) — staggered enter
                       animation re-fired every time the user switched
                       step tabs and came back, causing a noticeable
                       全 list opacity flicker. ShotCard hover micro-
                       motion is kept inside the card itself. */
                    <div
                        key={shot.id}
                        ref={(el) => { shotWrapperRefs.current.set(shot.id, el); }}
                    >
                        {projectFrameIndex >= 0 && <ShotCharacterUsePicker
                            frame={projectFrames[projectFrameIndex]}
                            uses={currentProject?.episode_character_uses || []}
                            assetIndex={assetIndex}
                            busy={lookBusyFrameId === shot.id}
                            onSelect={(use) => void selectShotCharacterUse(shot.id, use)}
                            onInsertReference={(_use, name) => {
                                const tag = `[character:${name}]`;
                                if (!shot.prompt.includes(tag)) updatePrompt(index, `${shot.prompt} ${tag}`.trim());
                            }}
                        />}
                        <ShotCard
                            projectId={currentProject?.id}
                            activeVideoTaskId={currentProject?.frames?.find((frame) => frame.id === shot.id)?.selected_video_id || shot.videoTaskId}
                            referenceImageUrls={isR2vImageBased(paramsState.model)
                                ? parseAssetTags(shot.prompt, shot.referenceVariantIds)
                                : []}
                            generateAudio={storyboardGeneratedAudio(paramsState.model, paramsState.audio)}
                            targetDuration={paramsState.duration}
                            shot={shot}
                            globalStylePrompt={displayedStyle.positivePrompt}
                            index={index}
                            totalShots={shots.length}
                            characters={characters}
                            scenes={scenes}
                            props={props}
                            assetIndex={assetIndex}
                            onUpdatePrompt={(prompt, optimized) => updatePrompt(index, prompt, optimized)}
                            onUpdateField={(field, value) => handleUpdateField(index, field, value)}
                            durationEditorConfig={durationEditorCfg}
                            onGenerateT2I={() => generateT2I(index)}
                            onGenerateVideo={() => generateVideoBatch(index, 1, paramsState)}
                            onDelete={() => deleteShot(index)}
                            onMoveUp={() => moveShot(index, "up")}
                            onMoveDown={() => moveShot(index, "down")}
                            onDuplicate={() => duplicateShot(index)}
                            onSetVideoMode={(mode) => setVideoMode(index, mode)}
                            videoModel={paramsState.model}
                            onOpenDrawer={() => setDrawerState({ isOpen: true, targetShotIndex: index })}
                            onSelectFrameAsset={() => setDrawerState({ isOpen: true, targetShotIndex: index, frameSlot: "last" })}
                            onInsertAsset={(type, name) => {
                                // Direct chip insert (same as chip bar logic, delegated to chip bar)
                                const tag = `[${type}:${name}]`;
                                updatePrompt(index, shots[index].prompt + " " + tag);
                            }}
                            onToggleReferenceVariant={(assetId, variantId, primaryVariantId) =>
                                toggleReferenceVariantForShot(index, assetId, variantId, primaryVariantId)
                            }
                            onCancelVideo={
                                shot.videoTaskId && currentProject
                                    ? async () => {
                                        const projectId = currentProject.id;
                                        const taskId = shot.videoTaskId!;
                                        try {
                                            await api.cancelVideoTask(projectId, taskId);
                                        } finally {
                                            // Optimistic local flip — backend has
                                            // already marked failed, but the next
                                            // refetch may take a beat. Failed state
                                            // surfaces the existing Retry button.
                                            setShots(prev => prev.map((s, i) =>
                                                i === index ? { ...s, videoStatus: "failed" as const } : s,
                                            ));
                                        }
                                    }
                                    : undefined
                            }
                            expanded={expandedShots.has(shot.id)}
                            onToggleExpanded={() => toggleShotExpanded(shot.id)}
                            /* PR-3c · 闭环生成: ShotCard 内全宽生成行 + count selector.
                               canGenerate: direct_r2v 需 prompt; t2i_i2v 还需 first frame. */
                            generateCount={paramsState.count}
                            genSummary={`${
                                shot.tabMode === "direct_r2v"
                                    ? (VIDEO_R2V_MODELS.find(m => m.id === videoConfig.r2vModel)?.name ?? videoConfig.r2vModel ?? "")
                                    : (VIDEO_I2V_MODELS.find(m => m.id === videoConfig.model)?.name ?? videoConfig.model ?? "")
                            } · ${paramsState.duration}s`}
                            canGenerate={
                                shot.prompt.trim().length > 0
                                && !resolveShotVideoInput(shot).error
                            }
                            onSetGenerateCount={(n) => handleShotParamsChange(shot, { ...paramsState, count: n })}
                            onGenerateBatch={(n) => generateVideoBatch(index, n, paramsState)}
                            inFlightCount={shotInFlight}
                            onRefineFrame={() => handleInitializeFrame(shot.id)}
                            onApplyRichRefinement={(candidateId, fields) => { void handleRichRefinement(shot.id, candidateId, fields); }}
                            onDiscardRichRefinement={(candidateId) => { void handleRichRefinement(shot.id, candidateId); }}
                            onMicroExpressionBeforePreview={async () => { await frameEdits.flush(); }}
                            onMicroExpressionApplied={async () => {
                                if (!currentProject?.id) return;
                                const updated = await api.getProject(currentProject.id);
                                updateProject(currentProject.id, updated);
                                const defaultMode = updated.default_generation_mode === "i2v" ? "t2i_i2v" : "direct_r2v";
                                setShots(updated.frames.map((frame: any) => frameToShotNode(frame, updated.video_tasks ?? [], defaultMode)));
                            }}
                            richRefinementBusy={richRefinementBusyFrameId === shot.id}
                            onUnpinVideo={() => handleUnpinVideo(shot.id)}
                            onUpdateDialogue={async (text: string) => {
                                if (!currentProject) return;
                                try {
                                    await api.updateFrame(currentProject.id, shot.id, { dialogue: text });
                                    const updated = await api.getProject(currentProject.id);
                                    if (updated?.frames) updateProject(currentProject.id, { frames: updated.frames });
                                } catch (e) {
                                    debugLog.error("Studio", "update dialogue failed", e);
                                }
                            }}
                        />
                        {/* PR-3j · Frame-level dialogue audio row. Only renders
                            when the frame has dialogue text; resolves the
                            bound character's voice_id and tracks stale state. */}
                        {(() => {
                            const frame = currentProject?.frames?.find((f: any) => f.id === shot.id);
                            if (!frame) return null;
                            const dialogueText = frame?.dialogue_structured?.line || frame?.dialogue;
                            const hasVideoTask = !!(frame.selected_video_id || (currentProject as any)?.video_tasks?.find((t: any) => t.frame_id === frame.id && t.status === "completed"));
                            // Show row when dialogue exists, or when video exists (dub available)
                            if (!dialogueText?.trim() && !hasVideoTask) return null;
                            const charId = Array.isArray(frame.character_ids) ? frame.character_ids[0] : null;
                            const speaker = charId ? characters.find((c: any) => c.id === charId) : null;
                            return (
                                <div className="mx-5 mb-4">
                                    <DialogueAudioRow
                                        scriptId={currentProject!.id}
                                        frameId={frame.id}
                                        dialogue={dialogueText}
                                        voiceId={speaker?.voice_id}
                                        audioUrl={frame.audio_url}
                                        audioError={frame.audio_error}
                                        snapshotDialogue={dialogueText}
                                        snapshotVoiceId={frame.dialogue_voice_id}
                                        snapshotInstructions={frame.dialogue_instructions}
                                        onUpdateDialogue={async (text: string) => {
                                            if (!currentProject) return;
                                            try {
                                                await api.updateFrame(currentProject.id, frame.id, { dialogue: text });
                                                const updated = await api.getProject(currentProject.id);
                                                if (updated?.frames) updateProject(currentProject.id, { frames: updated.frames });
                                            } catch (e) {
                                                debugLog.error("Studio", "update dialogue from audio row failed", e);
                                            }
                                        }}
                                        onAudioUpdated={async () => {
                                            if (!currentProject) return;
                                            try {
                                                const updated = await api.getProject(currentProject.id);
                                                if (updated?.frames) {
                                                    updateProject(currentProject.id, { frames: updated.frames });
                                                }
                                            } catch (e) {
                                                debugLog.warn("Studio", "refresh after audio gen failed", e);
                                            }
                                        }}
                                        videoUrl={(() => {
                                            const selectedId = frame.selected_video_id;
                                            const task = (currentProject as any)?.video_tasks?.find(
                                                (t: any) => selectedId ? t.id === selectedId : (t.frame_id === frame.id && t.status === "completed")
                                            );
                                            return task?.video_url;
                                        })()}
                                        videoTaskId={frame.selected_video_id ||
                                            (currentProject as any)?.video_tasks?.find(
                                                (t: any) => t.frame_id === frame.id && t.status === "completed"
                                            )?.id}
                                        previewVideoUrl={frame.preview_video_url}
                                        dubbedVideoUrl={frame.dubbed_video_url}
                                        dubOffsetMs={frame.dub_offset_ms ?? 0}
                                        onPreviewDub={async (videoTaskId: string, offsetMs: number) => {
                                            if (!currentProject) return;
                                            await api.previewDub(currentProject.id, frame.id, videoTaskId, offsetMs);
                                            const updated = await api.getProject(currentProject.id);
                                            if (updated?.frames) {
                                                updateProject(currentProject.id, { frames: updated.frames });
                                            }
                                        }}
                                        onApplyDub={async () => {
                                            if (!currentProject) return;
                                            await api.applyDub(currentProject.id, frame.id);
                                            const updated = await api.getProject(currentProject.id);
                                            if (updated?.frames) {
                                                updateProject(currentProject.id, { frames: updated.frames });
                                            }
                                        }}
                                        onRevertDub={async () => {
                                            if (!currentProject) return;
                                            await api.revertDub(currentProject.id, frame.id);
                                            const updated = await api.getProject(currentProject.id);
                                            if (updated?.frames) {
                                                updateProject(currentProject.id, { frames: updated.frames });
                                            }
                                        }}
                                    />
                                </div>
                            );
                        })()}
                        {/* Attached workbench: t2i_i2v 模式下渲染顺序为
                            Step 1 (T2ISubsection) → Step 2 (ParamsSection)
                            → CandidatesSection；direct_r2v 模式无 T2I 区，
                            ParamsSection → CandidatesSection。
                            Spec: docs/design/r2v-workflow-v3-unified.md §4.3.2
                            (PR-3a · Option A 最小修复)
                            v1 不加 explicit section header / first-frame
                            thumbnail in Step 2 — 看用户反馈再升级 v2. */}
                        {expandedShots.has(shot.id) ? (
                        <div className="mx-5 mb-[18px] motion-safe:animate-[shotPanelIn_220ms_cubic-bezier(0.22,1,0.36,1)_both]">
                            {showFrameInputs ? (
                                <div>
                                    <T2ISubsection
                                        imageUrls={shot.t2iImageUrls ?? []}
                                        selectedIndex={shot.t2iSelectedIndex ?? 0}
                                        storyboardFrameUrl={shot.imageUrl || undefined}
                                        promptIsEmpty={!shot.prompt.trim()}
                                        generating={shot.t2iStatus === "pending" || shot.t2iStatus === "processing"}
                                        inFlightTaskId={shot.t2iTaskId}
                                        inFlightStatus={shot.t2iStatus}
                                        onSelect={(i) => setShots(prev => prev.map((s, j) => {
                                            if (j !== index) return s;
                                            const next = setActiveT2IIndex(s, i);
                                            persistWorkbench(s.id, {
                                                t2i_selected_index: next.t2iSelectedIndex ?? 0,
                                            });
                                            return next;
                                        }))}
                                        onRemove={(i) => setShots(prev => prev.map((s, j) => {
                                            if (j !== index) return s;
                                            const next = removeT2IImage(s, i);
                                            persistWorkbench(s.id, {
                                                t2i_image_urls: next.t2iImageUrls ?? [],
                                                t2i_selected_index: next.t2iSelectedIndex ?? 0,
                                            });
                                            return next;
                                        }))}
                                        onGenerate={() => generateT2I(index)}
                                        onSelectAsset={() => setDrawerState({ isOpen: true, targetShotIndex: index, frameSlot: "first" })}
                                        onUpload={async (file) => {
                                            // Issue 10: upload an external image as a T2I首帧 candidate.
                                            // Backend appends + auto-selects; we mirror state from the
                                            // returned frame (single source of truth for the URL the
                                            // server actually persisted).
                                            //
                                            // Frontend may hold a synthetic shot id (`shot_<ts>_<rand>`)
                                            // for shots created via the + button that haven't been
                                            // persisted yet. The backend has no such frame_id → 404.
                                            // Lazy-create the frame on backend first, then upload.
                                            if (!currentProject) return { code: "network", detail: "no current project" };
                                            try {
                                                let effectiveFrameId = shot.id;
                                                const isSynthetic = effectiveFrameId.startsWith("shot_");
                                                if (isSynthetic) {
                                                    // Materialize the shot on backend before any
                                                    // frame-scoped op. Send minimum viable payload —
                                                    // the prompt + tab mode survives via separate
                                                    // workbench PATCH calls already triggered elsewhere.
                                                    try {
                                                        const created = await crudApi.createFrame(currentProject.id, {
                                                            scene_id: "",
                                                            action_description: shot.prompt || "",
                                                            insert_at: index,
                                                        } as any);
                                                        // Find the newly inserted frame by index in the response
                                                        const newFrame = Array.isArray(created?.frames)
                                                            ? created.frames[Math.min(index, created.frames.length - 1)]
                                                            : null;
                                                        if (newFrame?.id) {
                                                            effectiveFrameId = newFrame.id;
                                                            // Swap synthetic id → backend id locally so
                                                            // subsequent ops (workbench persist, generate, etc.)
                                                            // hit the real frame.
                                                            setShots(prev => prev.map((s, j) =>
                                                                j === index ? { ...s, id: newFrame.id } : s,
                                                            ));
                                                        }
                                                    } catch (createErr: any) {
                                                        debugLog.error("Studio", "Lazy createFrame failed", createErr);
                                                        const cdetail = createErr?.response?.data?.detail || createErr?.message || "create frame failed";
                                                        return { code: "server", detail: `先创建镜头失败：${cdetail}` };
                                                    }
                                                }

                                                const updatedFrame = await api.uploadT2IFrame(
                                                    currentProject.id,
                                                    effectiveFrameId,
                                                    file,
                                                );
                                                if (!updatedFrame) return { code: "network", detail: "empty response" };
                                                const nextUrls: string[] = updatedFrame.t2i_image_urls ?? [];
                                                const nextIdx: number = typeof updatedFrame.t2i_selected_index === "number"
                                                    ? updatedFrame.t2i_selected_index
                                                    : Math.max(0, nextUrls.length - 1);
                                                setShots(prev => prev.map((s, j) => {
                                                    if (j !== index) return s;
                                                    return {
                                                        ...s,
                                                        t2iImageUrls: nextUrls,
                                                        t2iSelectedIndex: nextIdx,
                                                        t2iImageUrl: nextUrls[nextIdx],
                                                        t2iStatus: "completed",
                                                    };
                                                }));
                                                return undefined;
                                            } catch (err: any) {
                                                debugLog.error("Studio", "T2I upload failed", err);
                                                const status = err?.response?.status;
                                                // Always surface the backend detail string so the
                                                // user can self-diagnose ("frame not found", "OSS
                                                // write denied", etc.) instead of "请重试".
                                                const detail = err?.response?.data?.detail
                                                    || err?.message
                                                    || `HTTP ${status ?? "?"}`;
                                                if (status === 413) return { code: "size", detail: String(detail) };
                                                if (status === 415) return { code: "type", detail: String(detail) };
                                                if (status === 404) return { code: "not_found", detail: String(detail) };
                                                if (status && status >= 500) return { code: "server", detail: String(detail) };
                                                return { code: "network", detail: String(detail) };
                                            }
                                        }}
                                        resolveUrl={resolveAssetUrl}
                                        frameLabel="首帧"
                                        firstLastFrameMode={shot.videoMode === "first_last_frame"}
                                        onUsePreviousEndFrame={previousSelectedVideo ? () => void usePreviousVideoEndFrame(index) : undefined}
                                        extractingPreviousEndFrame={extractingPreviousEndFrameId === shot.id}
                                    />
                                    {shot.videoMode === "first_last_frame" ? (
                                        <T2ISubsection
                                            imageUrls={shot.lastFrameImageUrls ?? []}
                                            selectedIndex={shot.lastFrameSelectedIndex ?? 0}
                                            promptIsEmpty={!shot.prompt.trim()}
                                            generating={shot.lastFrameStatus === "pending" || shot.lastFrameStatus === "processing"}
                                            inFlightTaskId={shot.lastFrameTaskId}
                                            inFlightStatus={shot.lastFrameStatus}
                                            onSelect={(i) => setShots(prev => prev.map((s, j) => {
                                                if (j !== index) return s;
                                                persistWorkbench(s.id, { last_frame_selected_index: i });
                                                return { ...s, lastFrameSelectedIndex: i };
                                            }))}
                                            onRemove={(i) => setShots(prev => prev.map((s, j) => {
                                                if (j !== index) return s;
                                                const urls = (s.lastFrameImageUrls ?? []).filter((_, k) => k !== i);
                                                const nextIndex = Math.max(0, Math.min(s.lastFrameSelectedIndex ?? 0, urls.length - 1));
                                                persistWorkbench(s.id, { last_frame_image_urls: urls, last_frame_selected_index: nextIndex });
                                                return { ...s, lastFrameImageUrls: urls, lastFrameSelectedIndex: nextIndex };
                                            }))}
                                            onGenerate={() => generateT2I(index, "last")}
                                            onSelectAsset={() => setDrawerState({ isOpen: true, targetShotIndex: index, frameSlot: "last" })}
                                            frameLabel="尾帧"
                                            onUpload={async (file) => {
                                                if (!currentProject) return { code: "network", detail: "no current project" };
                                                try {
                                                    const updated = await api.uploadT2IFrame(currentProject.id, shot.id, file, "last");
                                                    const urls = updated?.last_frame_image_urls ?? [];
                                                    const selected = typeof updated?.last_frame_selected_index === "number" ? updated.last_frame_selected_index : Math.max(0, urls.length - 1);
                                                    setShots(prev => prev.map((s, j) => j === index ? { ...s, lastFrameImageUrls: urls, lastFrameSelectedIndex: selected, lastFrameUrl: urls[selected] } : s));
                                                    return undefined;
                                                } catch (error: any) {
                                                    return { code: "server", detail: error?.response?.data?.detail || error?.message || "upload failed" };
                                                }
                                            }}
                                        />
                                    ) : null}
                                </div>
                            ) : null}
                            {/* Video parameters follow any required frame inputs. */}
                            <div className={showFrameInputs ? "border-t border-glass-border" : ""}>
                                <ParamsSection
                                    shotId={shot.id}
                                    modelList={modelList}
                                    title={shot.videoMode === "first_last_frame" ? "FL2V Params" : shot.videoMode === "t2v" ? "TEXT Params" : shot.tabMode === "direct_r2v" ? "R2V Params" : "I2V Params"}
                                    params={paramsState}
                                    onChange={(next) => handleShotParamsChange(shot, next)}
                                    inFlightCount={shotInFlight}
                                    errorMessage={shotErrors[shot.id] ?? null}
                                />
                            </div>
                            <div className="border-t border-glass-border">
                                <CandidatesSection
                                    shotId={shot.id}
                                    tasks={shotTasks}
                                    activeModel={paramsState.model}
                                    compareSelectedIds={compareSelectedIds}
                                    activeTaskId={currentProject?.frames?.find((f: any) => f.id === shot.id)?.selected_video_id ?? null}
                                    dubbedVideoUrl={currentProject?.frames?.find((f: any) => f.id === shot.id)?.dubbed_video_url}
                                    dubbedVideoTaskId={currentProject?.frames?.find((f: any) => f.id === shot.id)?.dubbed_video_task_id}
                                    onClickThumb={handleCandidateClick}
                                    onToggleStar={handleToggleStar}
                                    onSetLabel={handleSetLabel}
                                    onSetActive={(task) => handleSetActive(shot.id, task)}
                                    onCancel={handleCancelTask}
                                    onRetry={handleRetryTask}
                                    onReuseBatchParams={handleReuseBatchParams}
                                    onOpenCompare={() => setCompareModalOpen(true)}
                                    resolveUrl={resolveAssetUrl}
                                />
                            </div>
                        </div>
                        ) : null}
                    </div>
                    );
                })}

                {/* Add shot at end */}
                <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(shots.length * 0.03, 0.3) }}
                    whileHover={{ scale: 1.005 }}
                    whileTap={{ scale: 0.995 }}
                    onClick={() => addShot(shots.length - 1)}
                    className="w-full py-3.5 border border-dashed border-glass-border hover:border-primary/40 rounded-xl text-text-secondary hover:text-primary text-sm font-medium transition-all duration-300 flex items-center justify-center gap-2 bg-glass hover:bg-hover-bg"
                >
                    <Plus size={16} strokeWidth={1.5} />
                    {t("addShot")}
                </motion.button>
            </div>

            {/* Asset Drawer (fixed overlay) */}
            <AssetDrawer
                isOpen={drawerState.isOpen}
                onClose={() => setDrawerState({ isOpen: false, targetShotIndex: null })}
                characters={characters}
                scenes={scenes}
                props={props}
                assetIndex={assetIndex}
                frameSlot={drawerState.frameSlot}
                frameAssetError={assetIndexError}
                onReloadFrameAssets={() => {
                    if (!currentProject) return;
                    const projectId = currentProject.id;
                    setAssetIndexError("");
                    void api.getProjectAssetReferenceIndex(projectId)
                        .then((index) => {
                            if (useProjectStore.getState().currentProject?.id === projectId)
                                setIndexedProject({ projectId, assets: index.assets });
                        })
                        .catch((error) => {
                            if (useProjectStore.getState().currentProject?.id !== projectId) return;
                            setAssetIndexError("项目资产读取失败，请重试。");
                            debugLog.error("Studio", "Asset index reload failed", error);
                        });
                }}
                onSelectFrameVariant={async (entry, variantId) => {
                    const index = drawerState.targetShotIndex;
                    const shot = index == null ? undefined : shots[index];
                    if (index == null || !shot || !currentProject) throw new Error("当前镜头不可用，请重新打开资产库");
                    const fresh = await api.getProjectAssetReferenceIndex(currentProject.id);
                    if (useProjectStore.getState().currentProject?.id !== currentProject.id)
                        throw new Error("项目已切换，请重新打开资产库");
                    setIndexedProject({ projectId: currentProject.id, assets: fresh.assets });
                    const currentEntry = fresh.assets.find((candidate) =>
                        candidate.asset_type === entry.asset_type && candidate.asset_id === entry.asset_id
                        && candidate.source_scope === entry.source_scope
                        && candidate.source_container_id === entry.source_container_id
                        && candidate.variants.some((variant) => variant.id === variantId));
                    if (!currentEntry) throw new Error("该资产变体已不在当前项目，请从更新后的列表重选");
                    let frameId = shot.id;
                    if (frameId.startsWith("shot_")) {
                        const created = await crudApi.createFrame(currentProject.id, {
                            scene_id: "",
                            action_description: shot.prompt || "",
                            insert_at: index,
                        } as any);
                        const newFrame = Array.isArray(created?.frames)
                            ? created.frames[Math.min(index, created.frames.length - 1)] : null;
                        if (!newFrame?.id) throw new Error("创建镜头失败，请重试");
                        const syntheticId = frameId;
                        frameId = newFrame.id;
                        setShots(prev => prev.map((item, i) => i === index ? { ...item, id: frameId } : item));
                        setExpandedShots(prev => {
                            if (!prev.has(syntheticId)) return prev;
                            const next = new Set(prev);
                            next.delete(syntheticId);
                            next.add(frameId);
                            return next;
                        });
                    }
                    const isLast = drawerState.frameSlot === "last";
                    const updated = await api.attachAssetFrame(currentProject.id, frameId, currentEntry, variantId,
                        isLast ? "last" : "first");
                    const urls: string[] = isLast ? updated.last_frame_image_urls ?? [] : updated.t2i_image_urls ?? [];
                    const selected: number = isLast ? updated.last_frame_selected_index ?? 0 : updated.t2i_selected_index ?? 0;
                    setShots(prev => prev.map((item, i) => i === index ? (isLast
                        ? { ...item, id: frameId, lastFrameImageUrls: urls, lastFrameSelectedIndex: selected, lastFrameUrl: urls[selected] }
                        : { ...item, id: frameId, t2iImageUrls: urls, t2iSelectedIndex: selected, t2iImageUrl: urls[selected] }) : item));
                }}
                onSelectAsset={(type, name) => {
                    insertAssetFromDrawer(type, name);
                }}
                selectedVariantIds={drawerState.targetShotIndex == null
                    ? {}
                    : (shots[drawerState.targetShotIndex]?.referenceVariantIds ?? {})}
                onToggleVariant={toggleReferenceVariant}
            />
        </div>
        {/* Right-side Task Queue — pushes (does not overlay) the main
            column. Mounted in the layout flex, not as a fixed overlay,
            so width compression is automatic when it opens. */}
        <TaskQueuePanel
            open={queueOpen}
            onClose={() => setQueueOpen(false)}
            tasks={allVideoTasks}
            shotLabelByFrameId={shotLabelByFrameId}
            onJumpToShot={handleJumpToShot}
            onCancel={handleCancelTask}
            onRetry={handleRetryTask}
        />
        {/* Compare modal — portaled to body to escape clipped/transformed
            ancestors. Shows once user has shift-selected ≥2 and clicked
            the floating Compare button in any CandidatesSection. */}
        {compareModalOpen && compareTasks.length >= 2 ? (
            <CompareModal
                tasks={compareTasks}
                onClose={() => setCompareModalOpen(false)}
                resolveUrl={resolveAssetUrl}
            />
        ) : null}
        {/* LLM-generate frames dialog */}
        <StoryboardGenerateDialog
            isOpen={genDialogOpen}
            onClose={() => setGenDialogOpen(false)}
            project={currentProject as any}
            existingShotCount={currentProject?.frames?.length ?? 0}
            onConfirm={handleSmartGenerate}
            onJumpToScript={() => {
                setGenDialogOpen(false);
                window.dispatchEvent(new CustomEvent("navigateStep", { detail: "script" }));
            }}
        />
        <StoryboardAnalysisModal
                lineage={storyboardDraftLineage}
            isOpen={!!storyboardDraft}
            draft={storyboardDraft}
            feedback={storyboardFeedback}
            existingShotCount={currentProject?.frames?.length ?? 0}
            isBusy={storyboardDraftBusy}
            onRefine={handleRefineStoryboardDraft}
            onApply={handleApplyStoryboardDraft}
            onDiscard={handleDiscardStoryboardDraft}
        />
        </div>
    );
}
