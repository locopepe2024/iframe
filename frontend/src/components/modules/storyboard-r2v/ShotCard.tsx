"use client";

import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Trash2,
    ChevronUp,
    ChevronDown,
    Copy,
    Video,
    ImageIcon,
    AtSign,
    Maximize2,
    PanelBottomOpen,
    PanelBottomClose,
    Sparkles,
    Loader2,
    Code2,
    ChevronRight,
    Pin,
    PinOff,
    Play,
    Star,
    Palette,
    Sun,
} from "lucide-react";
import { useTranslations } from "next-intl";
import AssetChipBar from "./AssetChipBar";
import PromptExpandModal from "./PromptExpandModal";
import PolishPanel from "./PolishPanel";
import MicroExpressionPanel from "./MicroExpressionPanel";
import CameraMovementPanel from "./CameraMovementPanel";
import ShotFieldPanel from "./ShotFieldPanel";
import type { ExtraRosterEntry, ExtraShotInstance } from "@/store/projectStore";
import FieldTagChip, { AddFieldButton, type FieldType } from "./FieldTagChip";
import { buildGenerationPrompt, directorShotSuggestions } from "./buildAssembledPrompt";
import { CHARACTER_MOVE_DICTIONARY, findCharacterMove } from "@/lib/characterMoveDictionary";
import { directorFieldProposals } from "./directorFieldProposals";
import { resolveShotVideoInput } from "./shotVideoInput";
import { PendingTaskAffordance } from "@/components/shared/PendingTaskAffordance";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import PreviewVideo from "@/components/shared/preview/PreviewVideo";
import { useProjectStore } from "@/store/projectStore";
import { selectedVariantUrl } from "@/lib/characterImage";
import type { AssetReferenceIndexEntry } from "@/lib/api";

export interface ShotNode {
    id: string;
    prompt: string;
    promptIsOptimized?: boolean;
    tabMode: "t2i_i2v" | "direct_r2v";
    /** Concrete video input mode; legacy tabs map to i2v/r2v when absent. */
    videoMode?: "t2v" | "i2v" | "first_last_frame" | "r2v";
    lastFrameUrl?: string;
    lastFrameMediaId?: string;
    /** Optional per-shot video model override. */
    videoModel?: string;
    /** Explicit per-shot generated-audio choice. Undefined inherits the UI default. */
    generateAudio?: boolean;
    /** Explicit image variants selected from each semantic asset for this shot. */
    referenceVariantIds?: Record<string, string[]>;
    poseReferenceVariantIds?: Record<string, string[]>;
    directorSnapshotMediaId?: string | null;
    /** Server-projected, read-only visual direction from the confirmed plan. */
    directorShotContext?: {
        scene?: {
            location?: string;
            time_anchor?: string;
            continuity_in?: string;
            continuity_out?: string;
            atmosphere?: string;
        };
        shot?: {
            shot_size?: string;
            camera_angle?: string;
            camera_movement?: string;
            duration_seconds?: number | null;
            visual_intent?: string;
            director_effect?: string;
            performance_action?: string;
            action_physics?: string;
            composition?: string;
            ambient_sound?: string;
            lighting?: {
                key_source?: string;
                color_tone?: string;
                contrast?: string;
                practical_sources?: string[];
            };
            dialogue?: Array<{ speaker?: string; line?: string }>;
        };
    } | null;

    // T2I stage (only for t2i_i2v mode). Single-task fields stay here
    // for backward compat with existing shot drafts and the legacy
    // single-image preview. New: a history of generated T2I images per
    // shot + an index for the currently-active one (the one used as
    // first-frame for I2V). Persisted in localStorage with the rest of
    // the shot state. See Storyboard R2V redesign discussion.
    t2iImageUrl?: string;
    t2iTaskId?: string;
    t2iStatus?: "pending" | "processing" | "completed" | "failed";
    /** Ordered list of every T2I image URL this shot has produced.
     *  Newest at the end. Active one is at t2iSelectedIndex (defaults
     *  to last). Bounded to T2I_HISTORY_LIMIT FIFO to keep
     *  localStorage from growing without bound. */
    t2iImageUrls?: string[];
    t2iSelectedIndex?: number;
    lastFrameImageUrls?: string[];
    lastFrameSelectedIndex?: number;
    lastFrameTaskId?: string;
    lastFrameStatus?: "pending" | "processing" | "completed" | "failed";

    // Video stage (shared). The single-task fields stay for "the most
    // recent attempt" but the candidates panel reads from the shot's
    // full videoTaskIds history (cross-referenced against the script's
    // video_tasks list which is persisted server-side).
    videoUrl?: string;
    videoTaskId?: string;
    videoStatus?: "pending" | "processing" | "completed" | "failed";
    /** Issue 16 — final take selection (Z plan). Set in Assembly stage; read
     *  by Storyboard's ShotCard top preview as the canonical "this is the
     *  shipped output". Falls back to latest starred / latest completed /
     *  first frame when null. */
    finalTakeId?: string | null;
    /** Every video task this shot has spawned, oldest first. Each tab
     *  (t2i_i2v / direct_r2v) gets its own list — see videoTaskIdsByTab.
     *  Empty / missing → no history (e.g. legacy shots). */
    videoTaskIdsByTab?: {
        t2i_i2v?: string[];
        direct_r2v?: string[];
    };
    imageUrl?: string;

    // ─── Storyboard Schema v2 fields ────────────────────────────────
    duration?: number | null;
    visualDescription?: string | null;
    assembledPrompt?: string | null;
    dialogueStructured?: {
        speaker: string;
        line: string;
        emotion?: string | null;
        delivery?: string | null;
    } | null;
    cameraMovementStructured?: {
        primary: string;
        secondary?: string | null;
        speed: string;
        description?: string | null;
    } | null;
    shotSize?: string | null;
    cameraAngle?: string | null;
    composition?: string | null;
    transitionHint?: string | null;
    stylePromptOverride?: string | null;
    lightingOverride?: string | null;
    negativePromptOverride?: string | null;
    moveRef?: string | null;
    moveVariant?: string | null;
    performanceMoves?: Array<{ characterId: string; moveRef: string; moveVariant?: string | null }>;
    crowdInstances?: ExtraShotInstance[];
    richRefinementCandidate?: {
        id: string;
        source: string;
        mode?: string;
        fields: Record<string, unknown>;
        current_fields: Record<string, unknown>;
        rationale: Record<string, string>;
    } | null;
    microExpressionCandidate?: {
        id: string;
        items: Array<{ character_id: string; emotion_intent: string; timing: Array<{ phase: string; visible_change: string; relative_start: number; relative_end: number }>; uncertainties?: string[]; facial_channels?: Record<string, string> }>;
    } | null;
    microExpressionTiming?: Array<{
        character_id: string;
        character_name?: string;
        timing: Array<{ phase: string; visible_change: string; relative_start: number; relative_end: number }>;
    }>;
    cameraMovementCandidate?: {
        id: string;
        camera_movement_structured: { primary: string; secondary?: string | null; speed: string; description?: string | null };
        rationale: string; source_refs: string[]; uncertainties: string[];
    } | null;
    shotFieldCandidate?: {
        id: string;
        fields: Record<string, unknown>;
        rationale: Record<string, string>;
        source_refs: Record<string, string[]>;
        uncertainties: string[];
    } | null;

    /** When true, the user has manually pinned an active take. Hero
     *  shows a "Pinned" chip; autoSelectLatestVideo skips this frame on
     *  the backend, so new completed tasks stay in Candidates without
     *  overwriting the user's pick. Sourced from frame.is_video_pinned. */
    isVideoPinned?: boolean;
}

/** Cap on T2I image history per shot. Older drops off FIFO when adding. */
export const T2I_HISTORY_LIMIT = 10;
type PerformanceMoveValue = { characterId: string; moveRef: string; moveVariant?: string | null }[];

interface ShotCardProps {
    projectId?: string;
    activeVideoTaskId?: string;
    generateAudio?: boolean;
    targetDuration?: number;
    referenceImageUrls?: string[];
    onResolvePolishReferences?: () => Promise<{ urls: string[]; slots: { slot: number; asset_id: string; asset_type: "character" | "scene" | "prop"; name: string; variant_ids: string[]; description: string }[] }>;
    videoModel?: string;
    shot: ShotNode;
    index: number;
    totalShots: number;
    characters: any[];
    scenes: any[];
    props: any[];
    extraRoster?: ExtraRosterEntry[];
    onUpdateCrowdInstances?: (instances: ExtraShotInstance[]) => void;
    assetIndex?: AssetReferenceIndexEntry[];
    onUpdatePrompt: (prompt: string, optimized?: boolean) => void;
    onUpdateField: (field: string, value: string | number | null | PerformanceMoveValue) => void;
    globalStylePrompt?: string;
    effectiveVisual?: { style: string; lighting: string; scene: string; assets: string };
    effectiveFields?: Record<string, { value: unknown; source_kind: string; source_revision: number | null }>;
    onGenerateT2I: () => void;
    onGenerateVideo: () => void;
    onDelete: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDuplicate: () => void;
    onSetVideoMode: (mode: "t2v" | "i2v" | "first_last_frame" | "r2v") => void;
    onOpenDrawer: () => void;
    onSelectFrameAsset?: () => void;
    onInsertAsset: (type: string, name: string) => void;
    onToggleReferenceVariant?: (assetId: string, variantId: string, primaryVariantId?: string) => void;
    /** Duration editor config derived from model catalog */
    durationEditorConfig?: { min: number; max: number; step: number };
    /** Optional: Cancel CTA shown inside the pending-state affordance
     *  after the soft-stuck threshold (60 s by default). Caller should
     *  hit the backend cancel endpoint and refresh local state. */
    onCancelVideo?: () => Promise<void> | void;
    /** Issue 16 — per-shot expand state (P plan). When false, the
     *  Setup/Takes chips below the card are hidden entirely (zero chrome
     *  residue). When true, chips render. The chevron in the card's
     *  top-right corner toggles this. */
    expanded: boolean;
    onToggleExpanded: () => void;
    /** PR-3c · 闭环生成. Generation 移到 ShotCard 内的全宽行 (Action
     *  Bar 之后, disclosure bar 之前), 含 count selector 同行. Host
     *  传入 current count + handlers + canGenerate gate.
     *  Spec: r2v-workflow-v3-unified.md §4.3.1 / Q12. */
    generateCount?: number;
    /** At-a-glance "model · duration" summary shown in the generation row,
     *  visible even when the attached ShotPanel is collapsed (calm-default). */
    genSummary?: string;
    canGenerate?: boolean;
    onSetGenerateCount?: (count: number) => void;
    onGenerateBatch?: (count: number) => void;
    /** Active in-flight count for label flip (生成 ×N → 生成中 · N). */
    inFlightCount?: number;
    onApplyRichRefinement?: (candidateId: string, fields: string[]) => void;
    onDiscardRichRefinement?: (candidateId: string) => void;
    onMicroExpressionApplied?: () => Promise<void> | void;
    onMicroExpressionBeforePreview?: () => Promise<void> | void;
    richRefinementBusy?: boolean;
    onUpdateDialogue?: (text: string) => void;
    /** Active-take pin controls. When the user has manually pinned an
     *  active take (shot.isVideoPinned=true), the hero shows a "📌 Pinned"
     *  chip; clicking it fires onUnpinVideo to resume auto latest-wins. */
    onUnpinVideo?: () => void;
}

export default function ShotCard({
    projectId,
    activeVideoTaskId,
    generateAudio,
    targetDuration,
    referenceImageUrls = [],
    onResolvePolishReferences,
    videoModel,
    shot,
    index,
    totalShots,
    characters,
    scenes,
    props,
    extraRoster = [],
    onUpdateCrowdInstances,
    assetIndex,
    onUpdatePrompt,
    onUpdateField,
    globalStylePrompt = "",
    effectiveVisual,
    effectiveFields,
    onGenerateT2I,
    onGenerateVideo,
    onDelete,
    onMoveUp,
    onMoveDown,
    onDuplicate,
    onSetVideoMode,
    onOpenDrawer,
    onSelectFrameAsset,
    onInsertAsset: _onInsertAsset,
    onToggleReferenceVariant,
    durationEditorConfig,
    onCancelVideo,
    expanded,
    onToggleExpanded,
    generateCount = 1,
    genSummary,
    canGenerate = true,
    onSetGenerateCount,
    onGenerateBatch,
    inFlightCount = 0,
    onApplyRichRefinement,
    onDiscardRichRefinement,
    onMicroExpressionApplied,
    onMicroExpressionBeforePreview,
    richRefinementBusy = false,
    onUnpinVideo,
}: ShotCardProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const t = useTranslations("storyboardR2V");
    // Expand modal state (B5). Cmd/Ctrl+E in the small textarea
    // opens it; saving syncs back via onUpdatePrompt; cancel
    // discards the modal's draft without touching parent state.
    const [expandOpen, setExpandOpen] = useState(false);
    const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
    const [styleOpen, setStyleOpen] = useState(
        Boolean(shot.stylePromptOverride || shot.lightingOverride || shot.negativePromptOverride),
    );
    const [selectedRichFields, setSelectedRichFields] = useState<string[]>([]);
    useEffect(() => setSelectedRichFields([]), [shot.richRefinementCandidate?.id]);
    // currentProjectId — needed by PolishPanel to look up the
    // project's PromptConfig override server-side.
    const currentProjectId = useProjectStore((state) => state.currentProject?.id);
    // r2vSlots — when R2V tab is active, derive slot context from
    // @character references in the prompt so the polish system
    // prompt knows what character1/character2 ID maps to. Dedup by
    // slot number (first-seen wins) and sort ascending so the list
    // index aligns with HappyHorse's characterN positional mapping.
    // Backend polish_r2v_prompt re-numbers with enumerate(slots),
    // which only matches the prompt's characterN tags when slots
    // are unique and ordered.
    const r2vSlots = useCallback((): { description: string }[] => {
        if (shot.tabMode !== "direct_r2v") return [];
        const bySlot = new Map<number, string>();
        const tagPattern = /\[character(\d+):([^\]]+)\]/g;
        let match;
        while ((match = tagPattern.exec(shot.prompt)) !== null) {
            const slotN = parseInt(match[1], 10);
            if (bySlot.has(slotN)) continue;
            const name = match[2];
            const char = characters.find((c: any) => c.name === name);
            bySlot.set(slotN, char?.description ? `${name}: ${char.description}` : name);
        }
        return Array.from(bySlot.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, description]) => ({ description }));
    }, [shot.tabMode, shot.prompt, characters])();

    // polishImageUrls — feed vision-capable polish (Issue 13) with the
    // images the polish actually needs to "see":
    //   • i2v: the active first frame (T2I selection if any, else the
    //     Storyboard render). No frame yet → empty → text-only polish.
    //   • r2v: each referenced character's avatar/headshot/full body
    //     image, dedup'd by id. No references → empty → text-only.
    const polishImageUrls = useCallback((): string[] => {
        if (shot.tabMode === "direct_r2v") {
            return referenceImageUrls;
        }
        if (shot.videoMode === "first_last_frame") {
            const input = resolveShotVideoInput(shot);
            return [input.firstFrameUrl, input.lastFrameUrl].filter(Boolean);
        }
        if (shot.videoMode === "t2v") return [];
        // i2v: prefer active T2I image; fall back to storyboard frame.
        const active = (shot.t2iImageUrls && shot.t2iImageUrls.length > 0)
            ? shot.t2iImageUrls[Math.max(0, Math.min(shot.t2iSelectedIndex ?? 0, shot.t2iImageUrls.length - 1))]
            : (shot.t2iImageUrl || shot.imageUrl);
        return active ? [active] : [];
    }, [shot.tabMode, shot.videoMode, shot.t2iImageUrls, shot.t2iSelectedIndex, shot.t2iImageUrl, shot.imageUrl, shot.lastFrameImageUrls, shot.lastFrameSelectedIndex, referenceImageUrls])();

    // castAvatars — character avatar group for the "Cast:" row above
    // the prompt textarea (L5 borrow from 火山剧创's 出镜角色). De-
    // duped by id. We accept either [character:name] or [characterN:
    // name] patterns since the asset chip bar emits both formats.
    const castAvatars = useCallback((): Array<{ id: string; name: string; avatarUrl?: string }> => {
        const out: Array<{ id: string; name: string; avatarUrl?: string }> = [];
        const seen = new Set<string>();
        const tagPattern = /\[character\d*:([^\]]+)\]/g;
        let match;
        while ((match = tagPattern.exec(shot.prompt)) !== null) {
            const [, name] = match;
            const char = characters.find((c: any) => c.name === name);
            if (!char || seen.has(char.id)) continue;
            seen.add(char.id);
            const avatarUrl =
                char.avatar_url ||
                char.headshot_image_url ||
                char.image_url ||
                char.full_body_image_url ||
                selectedVariantUrl(char.reference_sheet) ||
                (char.full_body_asset?.variants?.[0]?.url);
            out.push({ id: char.id, name: char.name, avatarUrl });
        }
        return out;
    }, [shot.prompt, characters])();

    const assembledPromptPreview = useMemo(() => buildGenerationPrompt(
        shot, generateAudio ?? false, videoModel ?? "", effectiveVisual?.style ?? globalStylePrompt, effectiveVisual?.lighting ?? "", effectiveVisual?.scene ?? "", effectiveVisual?.assets ?? "",
    ), [
        shot.prompt, shot.shotSize, shot.cameraAngle, shot.cameraMovementStructured, shot.transitionHint,
        shot.stylePromptOverride, shot.lightingOverride, shot.directorShotContext, globalStylePrompt,
        effectiveVisual?.style, effectiveVisual?.lighting, effectiveVisual?.scene, effectiveVisual?.assets, shot.promptIsOptimized, generateAudio, videoModel,
    ]);
    const planSuggestions = useMemo(() => directorShotSuggestions(shot), [shot]);
    const planFieldProposals = useMemo(() => directorFieldProposals(shot, durationEditorConfig ?? { min: 3, max: 15 }), [shot, durationEditorConfig]);

    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        // Reset before measuring so shrinking also works (delete text).
        ta.style.height = "auto";
        const next = Math.min(ta.scrollHeight, 260);
        ta.style.height = `${next}px`;
    }, [shot.prompt]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const el = cardRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty("--spotlight-x", `${e.clientX - rect.left}px`);
        el.style.setProperty("--spotlight-y", `${e.clientY - rect.top}px`);
    }, []);

    const renderPreview = () => {
        if (shot.tabMode === "t2i_i2v") {
            if (shot.videoUrl) {
                return (
                    <PreviewVideo
                        src={shot.videoUrl}
                        projectId={projectId}
                        taskId={activeVideoTaskId}
                        alt={t("generatedVideo") || "Generated video"}
                        className="w-full aspect-video"
                    />
                );
            }
            if (shot.videoStatus === "processing" || shot.videoStatus === "pending") {
                return (
                    <div className="w-full aspect-video flex items-center justify-center">
                        <PendingTaskAffordance
                            statusLabel={shot.videoStatus === "pending" ? t("queued") : t("generatingVideo")}
                            taskId={shot.videoTaskId}
                            onCancel={onCancelVideo}
                        />
                    </div>
                );
            }
            if (shot.videoStatus === "failed") {
                return (
                    <div className="w-full aspect-video flex flex-col items-center justify-center gap-2">
                        <span className="text-[0.6875rem] text-status-failed-fg font-medium">{t("generationFailed")}</span>
                        <button
                            onClick={onGenerateVideo}
                            className="text-[0.6875rem] text-primary hover:text-primary/80 transition-colors font-medium"
                        >
                            {t("retry")}
                        </button>
                    </div>
                );
            }
            if (shot.t2iImageUrl) {
                // Fixed: was rendering raw `<img src={shot.t2iImageUrl}>` —
                // shot.t2iImageUrl is a relative path (e.g. "uploads/t2i_xxx.jpg")
                // which the browser resolved against the current origin → 404 →
                // broken icon + "Generated frame" alt fallback. PreviewImage
                // routes through getAssetUrl() (Issue 14).
                //
                // Issue 15: bottom badge label changed to "next: generate
                // video →" so the user knows the first frame is in place and
                // the next step is downstream, not another image gen.
                return (
                    <div className="w-full aspect-video relative">
                        <PreviewImage
                            src={shot.t2iImageUrl}
                            alt={t("t2iCompleted") || "First frame"}
                            className="w-full h-full"
                        />
                        <div className="absolute bottom-2 left-2 text-[0.625rem] px-1.5 py-0.5 rounded-full bg-status-completed-bg/90 text-white font-medium backdrop-blur-sm pointer-events-none">
                            {t("generateVideoNext")}
                        </div>
                    </div>
                );
            }
            if (shot.t2iStatus === "processing" || shot.t2iStatus === "pending") {
                return (
                    <div className="w-full aspect-video flex items-center justify-center">
                        <PendingTaskAffordance
                            statusLabel={shot.t2iStatus === "pending" ? t("queued") : t("t2iGenerating")}
                            taskId={shot.t2iTaskId}
                        />
                    </div>
                );
            }
            if (shot.t2iStatus === "failed") {
                return (
                    <div className="w-full aspect-video flex flex-col items-center justify-center gap-2">
                        <span className="text-[0.6875rem] text-status-failed-fg font-medium">{t("generationFailed")}</span>
                        <button
                            onClick={onGenerateT2I}
                            className="text-[0.6875rem] text-primary hover:text-primary/80 transition-colors font-medium"
                        >
                            {t("retry")}
                        </button>
                    </div>
                );
            }
            // I2V tab, no first frame yet — the active CTA is in the
            // Step 1 panel below (Hero state), not here. Just signal
            // "waiting for a first frame" so the user knows where to
            // act (Issue 15).
            return (
                <div className="w-full aspect-video flex flex-col items-center justify-center gap-2.5 text-text-muted">
                    <ImageIcon size={24} strokeWidth={1.6} className="opacity-50" />
                    <span className="font-mono text-[0.65625rem] uppercase tracking-[0.08em]">{t("generateImageOrUpload")}</span>
                </div>
            );
        }

        // Direct R2V mode
        if (shot.videoUrl) {
            return (
                <PreviewVideo
                    src={shot.videoUrl}
                    projectId={projectId}
                    taskId={activeVideoTaskId}
                    alt={t("generatedVideo") || "Generated video"}
                    className="w-full aspect-video"
                />
            );
        }
        if (shot.videoStatus === "processing" || shot.videoStatus === "pending") {
            return (
                <div className="w-full aspect-video flex items-center justify-center">
                    <PendingTaskAffordance
                        statusLabel={shot.videoStatus === "pending" ? t("queued") : t("generatingVideo")}
                        taskId={shot.videoTaskId}
                        onCancel={onCancelVideo}
                    />
                </div>
            );
        }
        if (shot.videoStatus === "failed") {
            return (
                <div className="w-full aspect-video flex flex-col items-center justify-center gap-2">
                    <span className="text-[0.6875rem] text-status-failed-fg font-medium">{t("generationFailed")}</span>
                    <button
                        onClick={onGenerateVideo}
                        className="text-[0.6875rem] text-primary hover:text-primary/80 transition-colors font-medium"
                    >
                        {t("retry")}
                    </button>
                </div>
            );
        }
        return (
            <div className="w-full aspect-video flex flex-col items-center justify-center gap-2.5 text-text-muted">
                <Video size={24} strokeWidth={1.6} className="opacity-50" />
                <span className="font-mono text-[0.65625rem] uppercase tracking-[0.08em]">{t("noVideoYet")}</span>
            </div>
        );
    };

    // Legacy renderGenerateButton was removed in the workbench
    // redesign (Sweep G, 2026-05-21): generation moved to the
    // ParamsSection's "Generate ×N" CTA inside the attached
    // ShotPanel, and T2I首帧 generation lives in T2ISubsection's
    // "+gen" tile. Keeping it on the ShotCard duplicated the action
    // with a different label (i18n vs English) and a different
    // batch-size semantics (×1 vs ×N) — confusing and the source of
    // the "two Generate buttons" bug report.
    // onGenerateVideo / onGenerateT2I are still wired for the inline
    // retry buttons inside renderPreview when a take fails.

    function ShotStatusBadge({ shot, t }: { shot: ShotNode; t: (key: string, values?: Record<string, number | string>) => string }) {
        const isProcessing = shot.videoStatus === "processing" || shot.t2iStatus === "processing";
        const isPending = !isProcessing && (shot.videoStatus === "pending" || shot.t2iStatus === "pending");
        const isFailed = !isProcessing && !isPending && (shot.videoStatus === "failed" || shot.t2iStatus === "failed");
        const isStarred = shot.isVideoPinned || shot.finalTakeId;
        if (isStarred) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-status-starred-border bg-status-starred-bg px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-status-starred-fg">
                    <span className="h-[5px] w-[5px] rounded-full bg-status-starred-solid" />
                    {t("statusStarred")}
                </span>
            );
        }
        if (isProcessing) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-status-processing-border bg-status-processing-bg px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-status-processing-fg">
                    <span className="h-[5px] w-[5px] rounded-full bg-status-processing-fg animate-pulse" />
                    {t("statusProcessing")}
                </span>
            );
        }
        if (isPending) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-status-pending-border bg-status-pending-bg px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-status-pending-fg">
                    <span className="h-[5px] w-[5px] rounded-full bg-status-pending-fg" />
                    {t("statusPending")}
                </span>
            );
        }
        if (isFailed) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-status-failed-border bg-status-failed-bg px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-status-failed-fg">
                    <span className="h-[5px] w-[5px] rounded-full bg-status-failed-fg" />
                    {t("statusFailed")}
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-glass-border bg-black/20 px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-text-secondary">
                <span className="h-[5px] w-[5px] rounded-full bg-text-muted" />
                {t("statusReady")}
            </span>
        );
    }

    const handleInsertAssetFromChip = (_type: string, name: string) => {
        const currentPrompt = shot.prompt;
        // Each unique character gets one fixed slot number throughout this
        // prompt: slot N → reference_image_urls[N-1] in HappyHorse R2V, so
        // referencing the same actor twice must reuse the same slot —
        // otherwise the model would expect two separate reference images.
        // Examples:
        //   first @小兔子 → [character1:小兔子]
        //   then @小狗 → [character2:小狗]
        //   then @小兔子 again → [character1:小兔子]   (reuse, NOT [character3:…])
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const existingTagRe = new RegExp(`\\[character(\\d+):${escapedName}\\]`);
        const existingMatch = currentPrompt.match(existingTagRe);

        let slot: number;
        if (existingMatch) {
            slot = parseInt(existingMatch[1], 10);
        } else {
            // Map of (slot → name) already in the prompt; first-seen wins
            // per slot so accidental dup tags don't inflate the count.
            const usedSlotByName = new Map<number, string>();
            const slotRe = /\[character(\d+):([^\]]+)\]/g;
            let m;
            while ((m = slotRe.exec(currentPrompt)) !== null) {
                const slotN = parseInt(m[1], 10);
                if (!usedSlotByName.has(slotN)) {
                    usedSlotByName.set(slotN, m[2]);
                }
            }
            const usedSlots = Array.from(usedSlotByName.keys());
            slot = usedSlots.length > 0 ? Math.max(...usedSlots) + 1 : 1;
        }
        const tag = `[character${slot}:${name}]`;

        const textarea = textareaRef.current;
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newPrompt = currentPrompt.slice(0, start) + tag + currentPrompt.slice(end);
            onUpdatePrompt(newPrompt);
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + tag.length;
                textarea.focus();
            }, 0);
        } else {
            onUpdatePrompt(currentPrompt + " " + tag);
        }
    };

    const isActiveT2I = shot.tabMode === "t2i_i2v";
    const videoMode = shot.videoMode ?? (isActiveT2I ? "i2v" : "r2v");

    return (
        <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            className="relative group"
        >
            {/* Spotlight border glow */}
            <div
                className="absolute -inset-[1px] rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-0"
                style={{
                    background:
                        "radial-gradient(600px circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), rgba(255,255,255,0.07), transparent 40%)",
                }}
            />

            {/* Floating card body — mock-aligned glass surface */}
            <div className="relative overflow-hidden rounded-[20px] border border-glass-border bg-surface shadow-[0_8px_30px_-10px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-base ease-out-quart group-hover:-translate-y-1 group-hover:shadow-[0_16px_50px_-12px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.07)] z-10">
                {/* Card top — shot no/cap + status badge + tab switcher */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="font-display text-[1.875rem] font-semibold leading-none text-text-secondary tracking-tight">
                            {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-text-muted leading-tight">
                            <span>SHOT</span>
                            {shot.shotSize ? (
                                <span className="ml-1.5 text-text-secondary font-medium">· {shot.shotSize}</span>
                            ) : null}
                            {shot.cameraMovementStructured?.primary ? (
                                <span className="ml-1.5 text-text-secondary">· {shot.cameraMovementStructured.primary}</span>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {shot.promptIsOptimized && shot.visualDescription?.trim() ? (
                            <button
                                type="button"
                                onClick={() => onUpdatePrompt(shot.visualDescription!.trim(), false)}
                                aria-label="恢复分镜"
                                title="恢复到原始剧本"
                                className="rounded-full border border-glass-border bg-surface-inset px-2.5 py-1 font-mono text-[0.625rem] font-semibold tracking-[0.04em] text-text-secondary transition-colors hover:border-primary/45 hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                            >
                                恢复分镜
                            </button>
                        ) : null}
                        <ShotStatusBadge shot={shot} t={t} />
                        <div role="tablist" aria-label={t("videoModeTabsLabel")} className="inline-flex flex-wrap items-center gap-0.5 rounded-full bg-surface-inset p-[3px]">
                            {(["t2v", "i2v", "first_last_frame", "r2v"] as const).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    role="tab"
                                    aria-selected={videoMode === mode}
                                    onClick={() => onSetVideoMode(mode)}
                                    className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 ${
                                        videoMode === mode
                                            ? "bg-elevated text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                                            : "text-text-secondary hover:text-foreground"
                                    }`}
                                >
                                    {t(mode === "t2v" ? "tabTextVideo" : mode === "i2v" ? "tabT2iI2v" : mode === "first_last_frame" ? "tabFirstLastFrame" : "tabDirectR2v")}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Main content: Preview + Editor */}
                <div className="flex flex-col gap-4 px-4 pb-4 lg:flex-row lg:gap-0 lg:px-5 lg:pb-0">
                    {/* Left: Preview */}
                    <div className="group/preview relative w-full shrink-0 self-start bg-surface-inset flex flex-col items-center justify-center overflow-hidden rounded-[14px] border border-glass-border shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] lg:w-72">
                        {renderPreview()}
                        {/* Selected-take amber halation */}
                        {(shot.isVideoPinned || shot.finalTakeId) && shot.videoUrl ? (
                            <div
                                className="pointer-events-none absolute inset-0 rounded-[14px]"
                                style={{ boxShadow: "inset 0 0 42px -8px rgba(255,169,77,0.28)" }}
                            />
                        ) : null}
                        {/* Hover play overlay — only on completed video */}
                        {shot.videoUrl ? (
                            <div className="absolute inset-0 grid place-items-center bg-overlay/20 opacity-0 transition-opacity duration-base group-hover/preview:opacity-100 pointer-events-none">
                                <div className="grid h-11 w-11 place-items-center rounded-full bg-foreground/90 text-on-accent">
                                    <Play size={17} fill="currentColor" className="ml-0.5" />
                                </div>
                            </div>
                        ) : null}
                        {/* Top-left selected chip */}
                        {(shot.isVideoPinned || shot.finalTakeId) && shot.videoUrl ? (
                            <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 rounded-full border border-status-starred-border bg-status-starred-bg/90 px-2 py-[3px] backdrop-blur-sm font-mono text-[0.5625rem] font-semibold uppercase tracking-[0.08em] text-status-starred-fg">
                                <Star size={10} fill="currentColor" aria-hidden="true" />
                                {t("selectedTake")}
                            </div>
                        ) : null}
                        {/* Duration chip */}
                        {shot.duration ? (
                            <div className="absolute bottom-2.5 right-2.5 z-10 rounded-full bg-overlay/70 px-2 py-0.5 backdrop-blur-sm font-mono text-[0.5625rem] text-foreground">
                                {shot.duration}s
                            </div>
                        ) : null}
                        {/* Pinned chip — overlays the hero when the user has
                            manually pinned an active take. Group/peer makes
                            the "Unpin" CTA fade in on hover so the chip stays
                            calm in the resting state. Only shown when a
                            video is actually rendered (no point pinning a
                            "no video" placeholder). */}
                        {shot.isVideoPinned && shot.videoUrl && onUnpinVideo ? (
                            <div className="group/pin absolute top-2.5 right-2.5 z-20 flex items-center gap-1">
                                <span
                                    className="inline-flex items-center gap-1 rounded-full border border-primary/55 bg-primary/20 backdrop-blur-sm px-2 py-[2px] font-mono text-[0.59375rem] uppercase tracking-[0.14em] text-primary shadow-[var(--glow-primary)]"
                                    title={t("activeTakePinnedTooltip")}
                                >
                                    <Pin size={9} aria-hidden="true" strokeWidth={2.2} fill="currentColor" />
                                    {t("activeTakePinned")}
                                </span>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onUnpinVideo(); }}
                                    title={t("unpinActiveTakeTooltip")}
                                    aria-label={t("unpinActiveTake")}
                                    className="opacity-0 transition-opacity duration-fast ease-out-quart group-hover/pin:opacity-100 focus-visible:opacity-100 inline-flex items-center gap-1 rounded-full border border-foreground/15 bg-black/55 backdrop-blur-sm px-1.5 py-[2px] font-mono text-[0.59375rem] uppercase tracking-[0.14em] text-foreground/80 hover:text-foreground hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                >
                                    <PinOff size={9} aria-hidden="true" strokeWidth={2.2} />
                                    {t("unpinActiveTakeShort")}
                                </button>
                            </div>
                        ) : null}
                    </div>

                    {/* Right: Prompt + Controls */}
                    <div className="flex min-w-0 w-full flex-col gap-3 py-0.5 lg:w-auto lg:flex-1 lg:pl-5">
                        {/* Cast avatar group */}
                        {castAvatars.length > 0 ? (
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-[0.625rem] uppercase tracking-[0.1em] text-text-muted">
                                    {t("shotCast")}
                                </span>
                                <div className="flex items-center -space-x-2">
                                    {castAvatars.slice(0, 3).map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => {
                                                document.dispatchEvent(
                                                    new CustomEvent("lumenx:navigateStep", { detail: "cast" }),
                                                );
                                            }}
                                            title={c.name}
                                            className="grid h-[26px] w-[26px] place-items-center overflow-hidden rounded-full border-2 border-surface bg-elevated transition-all duration-fast ease-out-quart hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                        >
                                            {c.avatarUrl ? (
                                                <PreviewImage
                                                    src={c.avatarUrl}
                                                    alt={c.name}
                                                    className="h-full w-full"
                                                    noLightbox
                                                />
                                            ) : (
                                                <span className="font-mono text-[0.5625rem] font-medium text-text-secondary">
                                                    {c.name.slice(0, 1)}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                    {castAvatars.length > 3 ? (
                                        <span className="grid h-[26px] w-[26px] place-items-center rounded-full border-2 border-surface bg-elevated font-mono text-[0.5625rem] font-medium text-text-secondary">
                                            +{castAvatars.length - 3}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}

                        {/* Prompt Editor wrapper — with left accent line */}
                        <div className="relative">
                            <textarea
                                ref={textareaRef}
                                value={shot.prompt}
                                onChange={(e) => onUpdatePrompt(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key.toLowerCase() === "e" && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault();
                                        setExpandOpen(true);
                                    }
                                }}
                                placeholder={t("promptPlaceholder")}
                                className="w-full resize-none bg-transparent border-l-2 border-glass-border pl-3.5 pr-8 py-1 text-[13px] leading-[1.7] text-foreground placeholder:text-text-muted focus:outline-none focus:border-l-primary/40 focus:bg-glass/30 transition-all duration-200 min-h-[80px] max-h-[260px] overflow-y-auto"
                                rows={5}
                            />
                            {/* Expand-to-modal icon — top-right,
                                always visible. 24×24 hit area on
                                a 14×14 visual via padding. */}
                            <button
                                type="button"
                                onClick={() => setExpandOpen(true)}
                                aria-label={t("promptExpand")}
                                title={`${t("promptExpand")} (⌘/Ctrl + E)`}
                                className="btn-tip absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded text-text-muted/70 transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                            >
                                <Maximize2 size={12} aria-hidden="true" />
                            </button>
                        </div>
                        {planFieldProposals.length > 0 && <details className="border-t border-border-subtle py-2 text-xs text-text-secondary">
                            <summary className="cursor-pointer text-foreground">拍摄计划字段 · {planFieldProposals.length} 项待审</summary>
                            <ul className="mt-2 divide-y divide-border-subtle">
                                {planFieldProposals.map(({ field, label, current, proposed, unavailableReason }) => <li key={field} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                                    <span className="w-8 shrink-0 font-medium text-foreground">{label}</span>
                                    <span className="min-w-0 flex-1 break-words">当前：{current}　计划：{proposed}{field === "duration" ? " 秒" : ""}</span>
                                    {unavailableReason && <span className="text-accent">{unavailableReason}</span>}
                                    <button type="button" className="shrink-0 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline"
                                        aria-label={`采用${label}`} disabled={!!unavailableReason} onClick={() => onUpdateField(field, proposed)}>采用</button>
                                </li>)}
                            </ul>
                        </details>}
                        {shot.richRefinementCandidate && <details className="border-t border-border-subtle py-2 text-xs text-text-secondary" open>
                            <summary className="cursor-pointer font-medium text-foreground">{shot.richRefinementCandidate.source} · {Object.keys(shot.richRefinementCandidate.fields).length} 项待审</summary>
                            {shot.richRefinementCandidate.mode === "initialization" && <p className="mt-2 text-text-muted">当前镜头的初始化建议；尚未应用，不会进入生成提示词。画面描述是起始画面候选，采纳前请检查首帧布局与光影。</p>}
                            <div className="mt-2 divide-y divide-border-subtle">
                                {Object.entries(shot.richRefinementCandidate.fields).map(([field, proposed]) => {
                                    const labels: Record<string, string> = {
                                        visual_description: "画面描述", shot_size: "景别", camera_angle: "机位", duration: "时长",
                                        transition_hint: "转场", camera_movement_structured: "运镜", blocking: "站位",
                                        dialogue_structured: "对白", audio_note: "声音", lighting: "光线",
                                    };
                                    const movedToDedicatedPanel = ["shot_size", "camera_angle", "composition", "camera_movement_structured"].includes(field);
                                    const unavailable = movedToDedicatedPanel || (shot.promptIsOptimized && field !== "duration");
                                    const display = (value: unknown) => value == null || value === "" ? "未设置"
                                        : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
                                    return <label key={field} className="flex items-start gap-2 py-2">
                                        <input type="checkbox" className="mt-0.5" checked={selectedRichFields.includes(field)} disabled={richRefinementBusy || unavailable}
                                            onChange={() => setSelectedRichFields((items) => items.includes(field)
                                                ? items.filter((item) => item !== field) : [...items, field])} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-medium text-foreground">{labels[field] || field}</span>
                                            <span className="block whitespace-pre-wrap break-words">当前：{display(shot.richRefinementCandidate?.current_fields?.[field])}</span>
                                            <span className="block whitespace-pre-wrap break-words">建议：{display(proposed)}</span>
                                            <span className="block text-text-muted">理由：{shot.richRefinementCandidate?.rationale?.[field] || "此候选缺少理由，请丢弃后重新生成"}</span>
                                            {movedToDedicatedPanel && <span className="block text-accent">此字段已移至静态起幅或运镜设计，请在对应入口重新生成</span>}
                                            {!movedToDedicatedPanel && unavailable && <span className="block text-accent">已采用完整优化稿，需重新审阅生成提示词后才能应用此项</span>}
                                        </span>
                                    </label>;
                                })}
                            </div>
                            <div className="mt-2 flex justify-end gap-3">
                                <button type="button" className="text-text-secondary hover:text-foreground"
                                    disabled={richRefinementBusy} onClick={() => onDiscardRichRefinement?.(shot.richRefinementCandidate!.id)}>丢弃</button>
                                <button type="button" className="text-primary hover:underline disabled:cursor-not-allowed disabled:text-text-muted"
                                    disabled={richRefinementBusy || !selectedRichFields.length}
                                    onClick={() => onApplyRichRefinement?.(shot.richRefinementCandidate!.id, selectedRichFields)}>应用所选</button>
                            </div>
                        </details>}
                        {planSuggestions.length > 0 && <details className="rounded-md border border-glass-border px-3 py-2 text-xs text-text-secondary">
                            <summary className="cursor-pointer text-foreground">拍摄计划参考 · {planSuggestions.length} 条（不会自动加入生成提示词）</summary>
                            <ul className="mt-2 space-y-2">
                                {planSuggestions.map((suggestion, index) => <li key={`${index}-${suggestion}`} className="flex items-start gap-2">
                                    <span className="min-w-0 flex-1 whitespace-pre-wrap">{suggestion}</span>
                                    <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => onUpdatePrompt([shot.prompt.trim(), suggestion].filter(Boolean).join("\n"))}>加入提示词</button>
                                </li>)}
                            </ul>
                        </details>}

                        {/* AI Polish — bilingual prompt rewrite using
                            the project's polish system prompt
                            (storyboard_polish / video_polish /
                            r2v_polish from PromptConfig). Routes to
                            the right API by tabMode. */}
                        <PolishPanel
                            generateAudio={generateAudio}
                            targetDuration={targetDuration}
                            dialogue={shot.dialogueStructured}
                            videoModel={videoModel}
                            prompt={shot.prompt}
                            optimizationDraft={buildGenerationPrompt(shot, generateAudio ?? false, videoModel ?? "",
                                effectiveVisual?.style ?? globalStylePrompt, effectiveVisual?.lighting ?? "", effectiveVisual?.scene ?? "", effectiveVisual?.assets ?? "")}
                            tabMode={shot.tabMode}
                            videoMode={shot.videoMode}
                            scriptId={currentProjectId ?? ""}
                            frameId={shot.id}
                            shotOverrides={{ style: shot.stylePromptOverride || effectiveVisual?.style || globalStylePrompt,
                                lighting: shot.lightingOverride || effectiveVisual?.lighting || "" }}
                            slots={r2vSlots}
                            imageUrls={polishImageUrls}
                            referenceVariantIds={shot.referenceVariantIds}
                            resolveR2VImageUrls={shot.tabMode === "direct_r2v" ? onResolvePolishReferences : undefined}
                            onBeforePreview={onMicroExpressionBeforePreview}
                            onApply={(text) => onUpdatePrompt(text, true)}
                        />
                        {currentProjectId && <MicroExpressionPanel
                            projectId={currentProjectId}
                            frameId={shot.id}
                            initialCandidate={shot.microExpressionCandidate ?? null}
                            accepted={shot.microExpressionTiming ?? []}
                            characterNames={Object.fromEntries(characters.map((character: any) => [character.id, character.name]))}
                            optimized={!!shot.promptIsOptimized}
                            onBeforePreview={onMicroExpressionBeforePreview}
                            onApplied={onMicroExpressionApplied}
                        />}
                        {currentProjectId && shot.cameraMovementCandidate && <CameraMovementPanel
                            projectId={currentProjectId}
                            frameId={shot.id}
                            current={shot.cameraMovementStructured ?? null}
                            initialCandidate={shot.cameraMovementCandidate ?? null}
                            optimized={!!shot.promptIsOptimized}
                            onBeforePreview={onMicroExpressionBeforePreview}
                            onApplied={onMicroExpressionApplied}
                        />}
                        {/* Structured field tags — interactive Popover editors */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {/* Duration: always visible */}
                            <FieldTagChip
                                field="duration"
                                value={shot.duration}
                                editorConfig={durationEditorConfig
                                    ? { type: "duration", ...durationEditorConfig }
                                    : { type: "duration", min: 3, max: 15, step: 1 }
                                }
                                onChange={(v) => onUpdateField("duration", v)}
                            />
                            {/* Shot size: visible when has value */}
                            {shot.shotSize !== undefined && shot.shotSize !== null && (
                                <FieldTagChip
                                    field="shotSize"
                                    value={shot.shotSize}
                                    editorConfig={{ type: "preset", presets: ["特写", "近景", "中景", "全景", "远景", "大特写"] }}
                                    onChange={(v) => onUpdateField("shotSize", v)}
                                />
                            )}
                            {/* Camera angle: visible when has value */}
                            {shot.cameraAngle !== undefined && shot.cameraAngle !== null && (
                                <FieldTagChip
                                    field="cameraAngle"
                                    value={shot.cameraAngle}
                                    editorConfig={{ type: "preset", presets: ["平视", "俯视", "仰视", "鸟瞰", "低角度"] }}
                                    onChange={(v) => onUpdateField("cameraAngle", v)}
                                />
                            )}
                            {/* Camera movement: visible when has value */}
                            {shot.cameraMovementStructured && (
                                <FieldTagChip
                                    field="cameraMovement"
                                    value={shot.cameraMovementStructured.description || shot.cameraMovementStructured.primary}
                                    editorConfig={{ type: "preset", presets: ["固定镜头", "缓慢推进", "跟随平移", "环绕旋转", "快速拉远", "缓慢上升"] }}
                                    onChange={(v) => onUpdateField("cameraMovement", v)}
                                />
                            )}
                            {/* Transition hint: visible when has value */}
                            {shot.transitionHint !== undefined && shot.transitionHint !== null && (
                                <FieldTagChip
                                    field="transitionHint"
                                    value={shot.transitionHint}
                                    editorConfig={{ type: "preset", presets: ["硬切", "淡入淡出", "溶解", "闪白", "划像"], allowCustom: true }}
                                    onChange={(v) => onUpdateField("transitionHint", v)}
                                />
                            )}
                            {/* "+" button to add optional fields */}
                            <AddFieldButton
                                onAdd={(field: FieldType) => {
                                    if (field === "cameraMovement") {
                                        onUpdateField("cameraMovement", "固定镜头");
                                    } else {
                                        onUpdateField(field, "");
                                    }
                                }}
                            />
                        </div>

                        {/* Per-shot art direction. Progressive disclosure keeps
                            the card calm while making the inheritance boundary
                            explicit when a scene needs different lighting. */}
                        <div className="mt-1 rounded-lg border border-glass-border bg-glass/20">
                            <button
                                type="button"
                                onClick={() => setStyleOpen((open) => !open)}
                                aria-expanded={styleOpen}
                                className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-[0.6875rem] text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                            >
                                <Palette size={13} className="text-primary/80" aria-hidden="true" />
                                <span className="font-medium">{t("shotStyleSection")}</span>
                                {(shot.stylePromptOverride || shot.lightingOverride || shot.negativePromptOverride) ? (
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary" title="已覆盖全局设置" />
                                ) : null}
                                <span className="ml-auto text-text-muted">{styleOpen ? t("shotStyleCollapse") : t("shotStyleInherit")}</span>
                            </button>
                            {styleOpen ? (
                                <div className="space-y-3 border-t border-border-subtle px-3 py-3">
                                    <label className="block">
                                        <span className="mb-1 flex items-center gap-1.5 text-[0.625rem] font-medium uppercase tracking-[0.08em] text-text-muted">
                                            <Palette size={11} aria-hidden="true" /> {t("shotStyleOverride")}
                                        </span>
                                        <textarea
                                            value={shot.stylePromptOverride ?? ""}
                                            onChange={(event) => onUpdateField("stylePromptOverride", event.target.value)}
                                            placeholder={effectiveVisual?.style || globalStylePrompt || t("shotStylePlaceholder")}
                                            rows={2}
                                            className="w-full resize-y rounded-md border border-glass-border bg-surface-inset px-2.5 py-2 text-[0.75rem] leading-relaxed text-foreground placeholder:text-text-muted focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-1 flex items-center gap-1.5 text-[0.625rem] font-medium uppercase tracking-[0.08em] text-text-muted">
                                            <Sun size={11} aria-hidden="true" /> {t("shotLightingOverride")}
                                        </span>
                                        <textarea
                                            value={shot.lightingOverride ?? ""}
                                            onChange={(event) => onUpdateField("lightingOverride", event.target.value)}
                                            placeholder={effectiveVisual?.lighting || t("shotLightingPlaceholder")}
                                            rows={2}
                                            className="w-full resize-y rounded-md border border-glass-border bg-surface-inset px-2.5 py-2 text-[0.75rem] leading-relaxed text-foreground placeholder:text-text-muted focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-1 block text-[0.625rem] font-medium uppercase tracking-[0.08em] text-text-muted">
                                            {t("shotNegativeOverride")}
                                        </span>
                                        <textarea
                                            value={shot.negativePromptOverride ?? ""}
                                            onChange={(event) => onUpdateField("negativePromptOverride", event.target.value)}
                                            placeholder={t("shotNegativePlaceholder")}
                                            rows={2}
                                            className="w-full resize-y rounded-md border border-glass-border bg-surface-inset px-2.5 py-2 text-[0.75rem] leading-relaxed text-foreground placeholder:text-text-muted focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                                        />
                                    </label>
                                    <p className="text-[0.625rem] leading-relaxed text-text-muted">
                                        {t("shotStyleHelper")}
                                    </p>
                                </div>
                            ) : null}
                        </div>

                        {currentProjectId && <ShotFieldPanel
                            projectId={currentProjectId}
                            frameId={shot.id}
                            initialCandidate={shot.shotFieldCandidate ?? null}
                            effectiveFields={effectiveFields}
                            optimized={!!shot.promptIsOptimized}
                            onBeforePreview={onMicroExpressionBeforePreview}
                            onApplied={onMicroExpressionApplied}
                        />}

                        {onUpdateCrowdInstances && <details className="border-t border-glass-border pt-3 text-xs text-text-secondary">
                            <summary className="cursor-pointer text-foreground">群演与背景人群</summary>
                            <div className="mt-3 space-y-2">
                                {(shot.crowdInstances ?? []).map((instance, index) => {
                                    const id = instance.extra_id || instance.template_id || "";
                                    const entry = extraRoster.find(item => item.extra_id === id);
                                    const availableVariants = Array.from(new Set([
                                        ...(entry?.reference_variant_ids ?? []),
                                        ...(entry?.reference_variant_id ? [entry.reference_variant_id] : []),
                                    ]));
                                    const selectedVariants = instance.variant_ids ?? [];
                                    const missingVariants = selectedVariants.filter(variantId => !availableVariants.includes(variantId));
                                    return <div key={index} className="grid grid-cols-2 gap-2 border-b border-glass-border pb-2">
                                        <span className="col-span-2 text-foreground">{entry?.label || ("已失效：" + id)}</span>
                                        <select aria-label="群演可见层" value={instance.layer} onChange={event => onUpdateCrowdInstances((shot.crowdInstances ?? []).map((item, i) => i === index ? { ...item, layer: event.target.value as ExtraShotInstance["layer"] } : item))} className="bg-input-bg border border-glass-border p-1">
                                            <option value="near">近景</option><option value="mid">中景</option><option value="far">远景</option>
                                        </select>
                                        <input aria-label="群演位置" value={instance.region} placeholder="空间位置" onChange={event => onUpdateCrowdInstances((shot.crowdInstances ?? []).map((item, i) => i === index ? { ...item, region: event.target.value } : item))} className="min-w-0 bg-input-bg border border-glass-border p-1" />
                                        {availableVariants.length > 0 && <fieldset className="col-span-2 space-y-1"><legend className="text-text-muted">群演变体</legend><div className="flex flex-wrap gap-x-3 gap-y-1">{availableVariants.map(variantId => <label key={variantId} className="inline-flex items-center gap-1"><input type="checkbox" checked={selectedVariants.includes(variantId)} onChange={event => onUpdateCrowdInstances((shot.crowdInstances ?? []).map((item, i) => {
                                            if (i !== index) return item;
                                            const next = event.target.checked
                                                ? Array.from(new Set([...selectedVariants, variantId]))
                                                : selectedVariants.filter(value => value !== variantId);
                                            return { ...item, variant_ids: next };
                                        }))} />{variantId}</label>)}</div></fieldset>}
                                        {missingVariants.length > 0 && <p className="col-span-2 text-danger">缺失变体：{missingVariants.join(", ")}。请重新选择已保存变体，系统不会自动替换。</p>}
                                        {entry?.kind === "fixed_extra" && <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={instance.face_readable} onChange={event => onUpdateCrowdInstances((shot.crowdInstances ?? []).map((item, i) => i === index ? { ...item, face_readable: event.target.checked } : item))} />面孔需要可辨认</label>}
                                        <button type="button" className="col-span-2 justify-self-start text-danger" onClick={() => onUpdateCrowdInstances((shot.crowdInstances ?? []).filter((_, i) => i !== index))}>移除</button>
                                    </div>;
                                })}
                                <select aria-label="添加群演" value="" onChange={event => {
                                    const entry = extraRoster.find(item => item.extra_id === event.target.value);
                                    if (!entry) return;
                                    onUpdateCrowdInstances([...(shot.crowdInstances ?? []), {
                                        ...(entry.kind === "fixed_extra" ? { extra_id: entry.extra_id } : { template_id: entry.extra_id }),
                                        asset_revision: entry.asset_revision ?? 1,
                                        layer: entry.kind === "fixed_extra" ? "near" : "far",
                                        region: "", face_readable: false, text_readable: false, variant_ids: [],
                                    }]);
                                }} className="w-full bg-input-bg border border-glass-border p-1">
                                    <option value="">添加已确认群演或模板</option>
                                    {extraRoster.map(entry => <option key={entry.extra_id} value={entry.extra_id}>{entry.label}</option>)}
                                </select>
                            </div>
                        </details>}

                        <details className="border-t border-glass-border pt-3 text-xs text-text-secondary">
                            <summary className="cursor-pointer text-foreground">角色动作引用</summary>
                            <div className="mt-3 space-y-2">
                                {(shot.performanceMoves ?? []).map((performanceMove, moveIndex) => {
                                    const selectedMove = findCharacterMove(performanceMove.moveRef);
                                    return <div key={`${performanceMove.characterId}-${moveIndex}`} className="space-y-1 rounded-md border border-glass-border p-2">
                                        <label className="block">
                                            <span className="mb-1 block text-text-muted">表演角色</span>
                                            <select aria-label={`表演角色 ${moveIndex + 1}`} value={performanceMove.characterId}
                                                onChange={(event) => onUpdateField("performance_moves", (shot.performanceMoves ?? []).map((item, index) => index === moveIndex ? { ...item, characterId: event.target.value } : item))}
                                                className="min-h-9 w-full rounded-md border border-glass-border bg-surface px-2 text-xs text-foreground">
                                                <option value="">选择角色</option>
                                                {characters.map((character: any) => <option key={character.id} value={character.id}>{character.name ?? character.id}</option>)}
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="mb-1 block text-text-muted">动作词典</span>
                                            <select aria-label={`角色动作 ${moveIndex + 1}`} value={performanceMove.moveRef}
                                                onChange={(event) => onUpdateField("performance_moves", (shot.performanceMoves ?? []).map((item, index) => index === moveIndex ? { ...item, moveRef: event.target.value, moveVariant: "" } : item))}
                                                className="min-h-9 w-full rounded-md border border-glass-border bg-surface px-2 text-xs text-foreground">
                                                <option value="">不引用动作</option>
                                                {CHARACTER_MOVE_DICTIONARY.map((move) => <option key={move.move_ref} value={move.move_ref}>{move.character_name} · {move.label}</option>)}
                                            </select>
                                        </label>
                                        {selectedMove && <select aria-label={`动作变体 ${moveIndex + 1}`} value={performanceMove.moveVariant ?? ""}
                                            onChange={(event) => onUpdateField("performance_moves", (shot.performanceMoves ?? []).map((item, index) => index === moveIndex ? { ...item, moveVariant: event.target.value } : item))}
                                            className="min-h-9 w-full rounded-md border border-glass-border bg-surface px-2 text-xs text-foreground">
                                            <option value="">默认动作表现</option>
                                            {selectedMove.variants.map((variant) => <option key={variant} value={variant}>{variant}</option>)}
                                        </select>}
                                        <button type="button" className="text-[0.6875rem] text-danger" onClick={() => onUpdateField("performance_moves", (shot.performanceMoves ?? []).filter((_, index) => index !== moveIndex))}>移除角色动作</button>
                                    </div>;
                                })}
                                <button type="button" className="min-h-8 rounded border border-glass-border px-2 text-[0.6875rem] text-text-secondary" onClick={() => onUpdateField("performance_moves", [...(shot.performanceMoves ?? []), { characterId: characters[0]?.id ?? "", moveRef: CHARACTER_MOVE_DICTIONARY[0]?.move_ref ?? "", moveVariant: null }])}>添加角色动作</button>
                                <p className="leading-relaxed text-text-muted">每个角色独立引用动作；不会把一个角色的招式套用到其他角色。</p>
                                {/* Legacy single-move controls remain available for older saved shots. */}
                                <label className="block">
                                    <span className="mb-1 block text-text-muted">旧版单角色动作</span>
                                    <select
                                        aria-label="主角招式词典"
                                        value={shot.moveRef ?? ""}
                                        onChange={(event) => {
                                            onUpdateField("move_ref", event.target.value);
                                            if (!event.target.value) onUpdateField("move_variant", "");
                                        }}
                                        className="min-h-9 w-full rounded-md border border-glass-border bg-surface px-2 text-xs text-foreground"
                                    >
                                        <option value="">不引用招式</option>
                                        {CHARACTER_MOVE_DICTIONARY.map((move) => <option key={move.move_ref} value={move.move_ref}>{move.character_name} · {move.label}</option>)}
                                    </select>
                                </label>
                                {findCharacterMove(shot.moveRef) && <>
                                    <label className="block">
                                        <span className="mb-1 block text-text-muted">本镜变体</span>
                                        <select
                                            aria-label="招式变体"
                                            value={shot.moveVariant ?? ""}
                                            onChange={(event) => onUpdateField("move_variant", event.target.value)}
                                            className="min-h-9 w-full rounded-md border border-glass-border bg-surface px-2 text-xs text-foreground"
                                        >
                                            <option value="">默认招式表现</option>
                                            {findCharacterMove(shot.moveRef)!.variants.map((variant) => <option key={variant} value={variant}>{variant}</option>)}
                                        </select>
                                    </label>
                                    <p className="leading-relaxed text-text-muted">招式会进入当前镜头组装提示词；它不会自动新增受伤、击飞或其他剧情。</p>
                                </>}
                            </div>
                        </details>

                        {/* Dialogue text display (read-only — editing via 配音工作台 modal) */}
                        {shot.dialogueStructured?.line && (
                            <div className="pl-3.5 border-l-2 border-accent/40">
                                <span className="block font-mono text-[0.5625rem] uppercase tracking-[0.08em] text-text-muted">
                                    {shot.dialogueStructured.speaker}
                                </span>
                                <span className="block font-display text-[0.90625rem] italic leading-snug text-text-secondary">
                                    “{shot.dialogueStructured.line}”
                                </span>
                            </div>
                        )}

                        {/* Assembled prompt preview (read-only, collapsible) — uses buildAssembledPrompt for real-time computation */}
                        {(shot.prompt || shot.shotSize || shot.cameraMovementStructured || shot.directorShotContext || shot.stylePromptOverride || shot.lightingOverride) && (
                            <div className="mt-1">
                                <button
                                    type="button"
                                    onClick={() => setPromptPreviewOpen(v => !v)}
                                    className="inline-flex items-center gap-1 text-[0.6875rem] text-text-muted hover:text-text-secondary transition-colors"
                                >
                                    <Code2 size={12} strokeWidth={1.5} />
                                    <span>{t("viewFinalPrompt")}</span>
                                    <ChevronRight
                                        size={11}
                                        className={`transition-transform duration-200 ${promptPreviewOpen ? "rotate-90" : ""}`}
                                    />
                                </button>
                                <AnimatePresence>
                                    {promptPreviewOpen && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="mt-1.5 rounded-md border border-glass-border bg-black/20 px-3 py-2 text-[0.71875rem] leading-relaxed font-mono space-y-2">
                                                {/* Final prompt as model receives it (computed real-time) */}
                                                <p className="text-text-secondary whitespace-pre-wrap">
                                                    {assembledPromptPreview}
                                                </p>
                                                {/* Duration is the only field NOT in prompt — show as API param note */}
                                                {shot.duration && (
                                                    <p className="text-text-muted border-t border-border-subtle pt-1.5">
                                                        <span className="text-status-completed-fg/70">{t("durationLabel")}:</span> {shot.duration}s {t("durationApiNote")}
                                                    </p>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}

                        {/* Asset Chip Bar */}
                        <AssetChipBar
                            characters={characters}
                            scenes={scenes}
                            props={props}
                            assetIndex={assetIndex}
                            selectedVariantIds={shot.referenceVariantIds}
                            onInsertAsset={handleInsertAssetFromChip}
                            onToggleVariant={onToggleReferenceVariant}
                        />
                    </div>
                </div>

                {/* actions row — full-width per mock (lives outside editor/card-body) */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-t border-border-subtle lg:px-5">
                            <div className="flex items-center gap-1 shrink-0">
                                <motion.button
                                    whileHover={{ scale: 1.06 }}
                                    whileTap={{ scale: 0.94 }}
                                    onClick={onOpenDrawer}
                                    className="ico-btn flex h-8 w-8 items-center justify-center rounded-[14px] text-text-muted transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                    title={t("browseAssets")}
                                >
                                    <AtSign size={15} strokeWidth={1.8} />
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.06 }}
                                    whileTap={{ scale: 0.94 }}
                                    onClick={onMoveUp}
                                    disabled={index === 0}
                                    className="ico-btn flex h-8 w-8 items-center justify-center rounded-[14px] text-text-muted transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                    title={t("moveUp")}
                                >
                                    <ChevronUp size={15} strokeWidth={1.8} />
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.06 }}
                                    whileTap={{ scale: 0.94 }}
                                    onClick={onMoveDown}
                                    disabled={index === totalShots - 1}
                                    className="ico-btn flex h-8 w-8 items-center justify-center rounded-[14px] text-text-muted transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                    title={t("moveDown")}
                                >
                                    <ChevronDown size={15} strokeWidth={1.8} />
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.06 }}
                                    whileTap={{ scale: 0.94 }}
                                    onClick={onDuplicate}
                                    className="ico-btn flex h-8 w-8 items-center justify-center rounded-[14px] text-text-muted transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                    title={t("duplicateShot")}
                                >
                                    <Copy size={15} strokeWidth={1.8} />
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.06 }}
                                    whileTap={{ scale: 0.94 }}
                                    onClick={onDelete}
                                    className="ico-btn flex h-8 w-8 items-center justify-center rounded-[14px] text-text-muted transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-status-failed-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                    title={t("deleteShot")}
                                >
                                    <Trash2 size={15} strokeWidth={1.8} />
                                </motion.button>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                {genSummary && (
                                    <span className="inline-flex items-center gap-1.5 shrink-0 font-mono text-[0.6875rem] text-text-secondary">
                                        <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[var(--glow-primary)]" />
                                        {genSummary}
                                    </span>
                                )}
                                <span className="font-mono text-[0.59375rem] uppercase tracking-[0.1em] text-text-muted hidden sm:inline">
                                    {t("countLabel")}
                                </span>
                                <div className="flex items-center gap-0.5 shrink-0 p-[3px] rounded-full bg-surface-inset">
                                    {[1, 2, 4, 6].map((n) => {
                                        const active = generateCount === n;
                                        return (
                                            <button
                                                key={n}
                                                type="button"
                                                onClick={() => onSetGenerateCount?.(n)}
                                                aria-pressed={active}
                                                aria-label={`Generate ${n} at a time`}
                                                title={t("genCandidatesEachTooltip", { n })}
                                                className={`grid h-7 min-w-[28px] place-items-center rounded-full font-mono text-[0.625rem] font-semibold transition-colors duration-fast ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 ${
                                                    active
                                                        ? "bg-primary text-on-accent"
                                                        : "text-text-muted hover:text-foreground"
                                                }`}
                                            >
                                                ×{n}
                                            </button>
                                        );
                                    })}
                                </div>
                                <motion.button
                                    whileHover={canGenerate && inFlightCount === 0 ? { scale: 1.02 } : undefined}
                                    whileTap={canGenerate && inFlightCount === 0 ? { scale: 0.98 } : undefined}
                                    type="button"
                                    onClick={() => onGenerateBatch?.(generateCount)}
                                    disabled={!canGenerate || inFlightCount > 0}
                                    title={!canGenerate
                                        ? (shot.tabMode === "t2i_i2v"
                                            ? t("needFirstFrameTooltip")
                                            : t("needPromptInputTooltip"))
                                        : t("genVideoCandidatesTooltip", { count: generateCount })}
                                    className="inline-flex items-center justify-center gap-1.5 rounded-full px-[13px] py-[7px] font-sans text-[0.75rem] font-semibold tracking-tight transition-all duration-fast ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 disabled:cursor-not-allowed disabled:opacity-40 bg-primary text-on-accent shadow-[var(--btn-pri-glow),inset_0_1.5px_0_rgba(255,255,255,0.14)] hover:bg-primary-hover hover:-translate-y-px disabled:hover:translate-y-0"
                                >
                                    {inFlightCount > 0 ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" strokeWidth={2} />
                                            <span>{t("genClusterInFlight", { count: inFlightCount })}</span>
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={14} strokeWidth={2} />
                                            <span>{t("generateBatch", { count: generateCount })}</span>
                                        </>
                                    )}
                                </motion.button>
                            </div>
                        </div>

                        {/* Disclosure bar — controls attached panel visibility */}
                        <button
                            type="button"
                            onClick={onToggleExpanded}
                            aria-expanded={expanded}
                            aria-label={expanded ? t("collapseShot") : t("expandShot")}
                            className="group/disc flex w-full items-center gap-2.5 border-t border-border-subtle px-5 py-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-text-muted transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                        >
                            {expanded ? (
                                <ChevronUp size={13} strokeWidth={2} className="text-text-muted transition-transform duration-fast group-hover/disc:text-text-secondary" aria-hidden="true" />
                            ) : (
                                <ChevronDown size={13} strokeWidth={2} className="text-text-muted transition-transform duration-fast group-hover/disc:text-text-secondary" aria-hidden="true" />
                            )}
                            <span className="text-foreground font-semibold">{expanded ? t("collapseShotShort") : t("expandShotShort")}</span>
                            <span className="text-text-muted/80">· {t("panelLabel")}</span>
                            {expanded ? (
                                <ChevronUp size={13} strokeWidth={2} className="ml-auto text-text-muted/60" aria-hidden="true" />
                            ) : (
                                <ChevronDown size={13} strokeWidth={2} className="ml-auto text-text-muted/60" aria-hidden="true" />
                            )}
                        </button>
            </div>
            {/* Focus-editor modal (B5 escape hatch) — opens via the
                expand icon or Cmd/Ctrl+E. Cancel discards; Save
                propagates back through the same onUpdatePrompt
                path the inline textarea uses. */}
            {expandOpen ? (
                <PromptExpandModal
                    initialValue={shot.prompt}
                    shotLabel={`Shot ${index + 1}`}
                    placeholder={t("promptPlaceholder")}
                    onSave={(next) => {
                        onUpdatePrompt(next);
                        setExpandOpen(false);
                    }}
                    onClose={() => setExpandOpen(false)}
                />
            ) : null}
        </div>
    );
}
