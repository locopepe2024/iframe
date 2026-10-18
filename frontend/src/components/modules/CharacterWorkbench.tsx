"use client";

import { useState, useEffect, useMemo, useRef, useId, useCallback } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Check, Image as ImageIcon, Lock, ChevronRight, ChevronDown, Video, PanelLeft, Sparkles, Search } from "lucide-react";
import { agentRequest, api, type AssetImageReviewRequest, type AssetLibraryReference, type AssetReferenceIndexEntry, type ChatModel } from "@/lib/api";

import { VariantSelector } from "../common/VariantSelector";
import { VideoVariantSelector } from "../common/VideoVariantSelector";
import { useProjectStore } from "@/store/projectStore";
import { Image as PhotoIcon } from "lucide-react";
import { getAssetUrl } from "@/lib/utils";
import { includeVisibleStyle } from "@/lib/assetPromptStyle";
import { AssetIndexPreview } from "@/components/shared/AssetIndexPreview";
import PreviewVideo from "@/components/shared/preview/PreviewVideo";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import { toast } from "@/store/toastStore";
import { resolveAssetGenerationModel } from "@/lib/modelCatalog";
import AssetImageSubmissionReview from "@/components/shared/AssetImageSubmissionReview";
import VideoPolishReview, { type VideoPolishMessages } from "./storyboard-r2v/VideoPolishReview";
import {
    buildCharacterImagePrompt,
    buildCharacterMotionPrompt,
    buildCharacterVideoPrompt,
    DEFAULT_CHARACTER_NEGATIVE_PROMPT,
    hasCharacterReferenceConstraint,
} from "@/lib/characterPrompts";
import ReferencePromptEditor, {
    type ReferenceCandidate,
    type ReferenceSuggestion,
} from "./playground/ReferencePromptEditor";
import { searchReferenceCandidates } from "@/lib/referenceCandidateSearch";
import { IDENTITY_FIELDS, LOOK_FIELDS, characterSectionText, normalizeCharacterFeatures,
    requirementNeedsReview, type IdentityFeatures, type LookFeatures } from "@/lib/characterStructuredDesign";

import type { AssetPlanEntry } from "@/lib/episodeAssetPlan";
import EpisodeAssetPlanPanel from "./EpisodeAssetPlanPanel";
import AssetNameEditor from "@/components/common/AssetNameEditor";

type DesignDraft = {
    route?: string;
    age_stage?: string;
    identity?: Record<string, unknown> & { basis?: DesignBasis[]; features?: IdentityFeatures };
    look?: Record<string, unknown> & { basis?: DesignBasis[]; features?: LookFeatures };
    unresolved?: string[];
    field_answers?: Record<string, string>;
    field_suggestions?: Record<string, string>;
    field_suggestion_choices?: Record<string, { age_stage?: string; route?: string }>;
    user_visual_requirements?: { identity?: string; look?: string };
    reference_assets?: AssetLibraryReference[];
    field_status?: Record<string, "stated" | "inferred" | "default" | "creative-choice">;
    skill_id?: string;
    skill_revision?: string;
    confirmed?: boolean;
};

type DesignBasis = "script_fact" | "user_specified" | "confirmed_design" | "verified_reference" | "creative_choice";

function normalizeDesignBasis(value: unknown): DesignBasis[] {
    const allowed: DesignBasis[] = ["script_fact", "user_specified", "confirmed_design", "verified_reference", "creative_choice"];
    const values = Array.isArray(value) ? value : [value];
    const normalized = values.filter((item): item is DesignBasis => typeof item === "string" && allowed.includes(item as DesignBasis));
    return normalized.length ? Array.from(new Set(normalized)) : ["creative_choice"];
}

function designPromptDescription(identity: unknown, look: unknown, answers: unknown[] = []): string {
    return [identity, look, ...answers]
        .filter((value): value is string => typeof value === "string" && !!value.trim())
        .join("。 ");
}

function preserveVisualRequirement(proposal: string, requirement: string): string {
    const specified = requirement.trim();
    return specified && !proposal.includes(specified) ? designPromptDescription(specified, proposal) : proposal;
}

function designScopeDescription(route?: string, ageStage?: string): string[] {
    const routeLabels: Record<string, string> = {
        "realistic-modern": "真人写实造型",
        "historical-costume": "古装武侠造型",
        "xianxia-fantasy": "仙侠幻想造型",
        "anime-stylized": "动漫国漫造型",
    };
    const ageLabels: Record<string, string> = {
        child: "儿童年龄表现",
        teen: "少年少女年龄表现",
        "young-adult": "青年年龄表现",
        adult: "成年人年龄表现",
        "older-adult": "老年年龄表现",
    };
    return [route ? routeLabels[route] || route : "", ageStage ? ageLabels[ageStage] || ageStage : ""];
}

function confirmedDesignDescription(design: DesignDraft | undefined): string {
    // The question remains in the saved design draft for auditability; only
    // the user's confirmed value belongs in an image prompt.
    const answers = Object.values(design?.field_answers || {});
    return designPromptDescription(
        characterSectionText(normalizeCharacterFeatures(design?.identity?.features, IDENTITY_FIELDS.map(([key]) => key)),
            IDENTITY_FIELDS.map(([key]) => key), design?.identity?.visual_notes),
        characterSectionText(normalizeCharacterFeatures(design?.look?.features, LOOK_FIELDS.map(([key]) => key)),
            LOOK_FIELDS.map(([key]) => key), design?.look?.visual_notes),
        [...answers, ...designScopeDescription(design?.route, design?.age_stage)],
    );
}

function normalizeDesignQuestions(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => typeof value === "string" ? value.split(/[；;\n]+/) : [])
        .map((value) => value.trim().replace(/[。.!！?？]+$/, ""))
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index);
}

function actionableDesignQuestions(
    values: unknown,
    answers: Record<string, string> = {},
    suggestions: Record<string, string> = {},
): string[] {
    return normalizeDesignQuestions(values).filter((question) =>
        !!answers[question]?.trim()
        || !!suggestions[question]?.trim()
        || /冲突|矛盾|不一致|但|conflict|contradict|inconsistent/i.test(question),
    );
}

function selectedVariantUrl(unit: any, fallback?: string): string | undefined {
    const variants = Array.isArray(unit?.variants)
        ? unit.variants
        : Array.isArray(unit?.image_variants)
            ? unit.image_variants
            : [];
    const selectedId = unit?.selected_id || unit?.selected_image_id;
    return variants.find((variant: any) => variant?.id === selectedId)?.url
        || fallback
        || variants.at(-1)?.url;
}

function selectedReferenceSheetUrl(referenceSheet: any): string | undefined {
    const variants = Array.isArray(referenceSheet?.image_variants)
        ? referenceSheet.image_variants
        : [];
    if (variants.length === 0) return undefined;

    const selectedId = referenceSheet?.selected_image_id;
    if (selectedId) return variants.find((variant: any) => variant?.id === selectedId)?.url;
    return variants[0]?.url;
}

function referenceKey(reference?: AssetLibraryReference): string {
    return reference ? `${reference.asset_type}:${reference.asset_id}:${reference.variant_id}` : "";
}

function referenceScopeLabel(scope?: AssetReferenceIndexEntry["source_scope"]): string {
    switch (scope) {
        case "episode": return "本集";
        case "project": return "项目";
        case "series": return "系列";
        case "global": return "全局素材";
        default: return "素材库";
    }
}

function AssetReferencePicker({
    candidates,
    selected,
    onChange,
    title,
    description,
    onOpen,
}: {
    candidates: ReferenceCandidate[];
    selected: AssetLibraryReference[];
    onChange: (references: AssetLibraryReference[]) => void;
    title: string;
    description: string;
    onOpen?: () => void;
}) {
    const [query, setQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const generatedId = useId().replace(/:/g, "");
    const searchId = `character-reference-search-${generatedId}`;
    const optionId = (index: number) => `${searchId}-option-${index}`;
    const selectedKeys = new Set(selected.map(referenceKey));
    const filtered = searchReferenceCandidates(candidates, query).slice(0, 20);

    const toggle = (candidate: ReferenceCandidate) => {
        if (!candidate.reference) return;
        const key = referenceKey(candidate.reference);
        onChange(selectedKeys.has(key)
            ? selected.filter((item) => referenceKey(item) !== key)
            : [...selected, candidate.reference]);
    };

    return (
        <section className="mt-3 rounded-md border border-glass-border bg-surface/60 p-3">
            <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => {
                    if (!isOpen) onOpen?.();
                    setIsOpen(!isOpen);
                }}
                className="flex min-h-8 w-full items-center justify-between gap-2 text-left text-xs font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
                <span>{title}{selected.length > 0 ? ` · ${selected.length}` : ""}</span>
                <ImageIcon size={15} className="shrink-0 text-text-muted" aria-hidden="true" />
            </button>
            {isOpen && <>
            <p className="mt-1 text-[11px] leading-4 text-text-muted">{description}</p>
            <label className="sr-only" htmlFor={searchId}>搜索角色参考素材</label>
            <div className="relative mt-2">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-3 text-text-muted" aria-hidden="true" />
                <input
                    id={searchId}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "ArrowDown" && filtered.length > 0) {
                            event.preventDefault();
                            document.getElementById(optionId(0))?.focus();
                        } else if (event.key === "Enter" && filtered.length > 0) {
                            event.preventDefault();
                            toggle(filtered[0]);
                        }
                    }}
                    aria-label="搜索角色参考素材"
                    placeholder="搜索名称、来源或变体"
                    className="h-9 w-full rounded-md border border-glass-border bg-surface pl-8 pr-2 text-xs text-foreground placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
            </div>
            {selected.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="已选择的角色参考图">
                    {selected.map((reference) => {
                        const candidate = candidates.find((item) => referenceKey(item.reference) === referenceKey(reference));
                        return (
                            <button
                                type="button"
                                key={referenceKey(reference)}
                                onClick={() => onChange(selected.filter((item) => referenceKey(item) !== referenceKey(reference)))}
                                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 text-[11px] text-primary hover:bg-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                                aria-label={`移除参考图 ${candidate?.label || reference.variant_id}`}
                            >
                                <span className="max-w-[12rem] truncate">{candidate?.label || reference.variant_id}</span>
                                <X size={12} aria-hidden="true" />
                            </button>
                        );
                    })}
                </div>
            )}
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto" role="listbox" aria-label="角色参考素材结果" aria-multiselectable="true">
                {filtered.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-text-muted">{candidates.length ? "没有匹配的参考素材" : "暂无可用参考素材"}</p>
                ) : filtered.map((candidate, index) => {
                    const key = referenceKey(candidate.reference);
                    const isSelected = selectedKeys.has(key);
                    return (
                        <button
                            type="button"
                            id={optionId(index)}
                            key={key}
                            role="option"
                            aria-selected={isSelected}
                            onKeyDown={(event) => {
                                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                    event.preventDefault();
                                    const nextIndex = event.key === "ArrowDown"
                                        ? Math.min(index + 1, filtered.length - 1)
                                        : Math.max(index - 1, 0);
                                    document.getElementById(optionId(nextIndex))?.focus();
                                } else if (event.key === "Enter") {
                                    event.preventDefault();
                                    toggle(candidate);
                                } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    document.getElementById(searchId)?.focus();
                                }
                            }}
                            onClick={() => toggle(candidate)}
                            className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${isSelected ? "bg-primary/10" : "hover:bg-hover-bg"}`}
                        >
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-inset">
                                {candidate.previewRef ? <AssetIndexPreview asset={candidate.previewRef} /> : <ImageIcon size={14} className="text-text-muted" aria-hidden="true" />}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs text-foreground">{candidate.label}</span>
                                <span className="block truncate text-[11px] text-text-muted">
                                    {[candidate.sourceLabel || "素材库", candidate.variantLabel ? `变体：${candidate.variantLabel}` : ""].filter(Boolean).join(" · ")}
                                </span>
                            </span>
                            {isSelected && <Check size={14} className="shrink-0 text-primary" aria-label="已选择" />}
                        </button>
                    );
                })}
            </div>
            </>}
        </section>
    );
}
interface CharacterWorkbenchProps {
    asset: any;
    onClose: () => void;
    onUpdateDescription: (desc: string) => void;
    onUpdateAttributes?: (attributes: Record<string, unknown>) => void | Promise<void>;
    onRename?: (name: string) => Promise<void>;
    onGenerate: (type: string, prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number, references?: AssetLibraryReference[], imageGenerationMode?: "text" | "reference", reviewFingerprint?: string) => void;
    generatingTypes: { type: string; batchSize: number }[];
    stylePrompt?: string;
    styleNegativePrompt?: string;
    onGenerateVideo?: (prompt: string, duration: number, subType?: string) => void;
    onDeleteVideo?: (videoId: string) => void;
    isGeneratingVideo?: boolean;
    planEntries?: AssetPlanEntry[];
}

export default function CharacterWorkbench({ asset, onClose, onUpdateDescription, onUpdateAttributes, onRename, onGenerate, generatingTypes = [], stylePrompt = "", styleNegativePrompt = "", onGenerateVideo, onDeleteVideo, isGeneratingVideo, planEntries = [] }: CharacterWorkbenchProps) {
    const tc = useTranslations("character");
    const [activePanel, setActivePanel] = useState<"full_body" | "three_view" | "headshot" | "video">("full_body");
    const [isPlanOpen, setIsPlanOpen] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
    const savedDesign = (asset.character_design?.design_draft || {}) as DesignDraft;
    const [designRoute, setDesignRoute] = useState(savedDesign.route || "realistic-modern");
    const [designAgeStage, setDesignAgeStage] = useState(savedDesign.age_stage || "");
    const [designNotes, setDesignNotes] = useState(String(savedDesign.identity?.visual_notes || ""));
    const [lookNotes, setLookNotes] = useState(String(savedDesign.look?.visual_notes || ""));
    const [identityFeatures, setIdentityFeatures] = useState<IdentityFeatures>(
        normalizeCharacterFeatures(savedDesign.identity?.features, IDENTITY_FIELDS.map(([key]) => key)));
    const [lookFeatures, setLookFeatures] = useState<LookFeatures>(
        normalizeCharacterFeatures(savedDesign.look?.features, LOOK_FIELDS.map(([key]) => key)));
    const [userVisualRequirements, setUserVisualRequirements] = useState({
        identity: savedDesign.user_visual_requirements?.identity || "",
        look: savedDesign.user_visual_requirements?.look || "",
    });
    const [designIdentityBasis, setDesignIdentityBasis] = useState<DesignBasis[]>(normalizeDesignBasis(savedDesign.identity?.basis));
    const [designLookBasis, setDesignLookBasis] = useState<DesignBasis[]>(normalizeDesignBasis(savedDesign.look?.basis));
    const [designSource, setDesignSource] = useState<"stated" | "creative-choice">(savedDesign.field_status?.visual_notes === "creative-choice" ? "creative-choice" : "stated");
    const [designUnresolved, setDesignUnresolved] = useState<string[]>(
        actionableDesignQuestions(savedDesign.unresolved, savedDesign.field_answers, savedDesign.field_suggestions),
    );
    const [designFieldAnswers, setDesignFieldAnswers] = useState<Record<string, string>>(savedDesign.field_answers || {});
    const [designFieldSuggestions, setDesignFieldSuggestions] = useState<Record<string, string>>(savedDesign.field_suggestions || {});
    const [designFieldSuggestionChoices, setDesignFieldSuggestionChoices] = useState<Record<string, { age_stage?: string; route?: string }>>(savedDesign.field_suggestion_choices || {});
    const [designReferences, setDesignReferences] = useState<AssetLibraryReference[]>(savedDesign.reference_assets || []);
    const [showIdentityFields, setShowIdentityFields] = useState(false);
    const [showLookFields, setShowLookFields] = useState(false);
    const [designSkillRevision, setDesignSkillRevision] = useState(savedDesign.skill_revision || "");
    const [designModels, setDesignModels] = useState<ChatModel[]>([]);
    const [designModel, setDesignModel] = useState("");
    const [designing, setDesigning] = useState(false);
    const [designStatus, setDesignStatus] = useState(savedDesign.confirmed ? "confirmed" : "draft");
    const [designRevision, setDesignRevision] = useState<number>(asset.character_design?.design_revisions?.at(-1)?.revision || 0);
    const [savingDesign, setSavingDesign] = useState(false);
    const [designError, setDesignError] = useState("");
    const [designReview, setDesignReview] = useState<{
        source: string; request: Record<string, unknown>; messages: VideoPolishMessages;
        media: { label: string; url: string }[]; reviewToken: string; formatNote: string;
    } | null>(null);
    const updateProject = useProjectStore(state => state.updateProject);
    const currentProject = useProjectStore(state => state.currentProject);
    const [assetIndex, setAssetIndex] = useState<AssetReferenceIndexEntry[]>([]);
    const assetIndexRequest = useRef(0);
    const assetIndexRevision = JSON.stringify(
        [currentProject?.characters, currentProject?.scenes, currentProject?.props].map((items) =>
            Array.isArray(items) ? items.map((item: any) => [
                item?.id,
                item?.updated_at,
                item?.image_asset?.variants?.map((variant: any) => variant.id),
                item?.reference_sheet?.image_variants?.map((variant: any) => [variant.id, variant.display_name]),
                item?.full_body_asset?.variants?.map((variant: any) => [variant.id, variant.display_name]),
                item?.three_view_asset?.variants?.map((variant: any) => [variant.id, variant.display_name]),
                item?.headshot_asset?.variants?.map((variant: any) => [variant.id, variant.display_name]),
            ]) : [],
        ),
    );
    const selectionQueue = useRef<Promise<void>>(Promise.resolve());
    const selectionVersion = useRef(0);
    const [promptReferences, setPromptReferences] = useState<Record<"full_body" | "three_view" | "headshot", AssetLibraryReference[]>>({
        full_body: [],
        three_view: [],
        headshot: [],
    });
    const [promptPickerReferences, setPromptPickerReferences] = useState<Record<"full_body" | "three_view" | "headshot", AssetLibraryReference[]>>({
        full_body: [],
        three_view: [],
        headshot: [],
    });
    const [promptModes, setPromptModes] = useState<Record<"full_body" | "three_view" | "headshot", "text" | "reference">>({
        full_body: "text",
        three_view: "text",
        headshot: "text",
    });
    const [pendingImageReview, setPendingImageReview] = useState<AssetImageReviewRequest | null>(null);

    useEffect(() => {
        let active = true;
        void agentRequest<{ models: ChatModel[] }>("/models").then(({ models }) => {
            if (!active) return;
            const available = models.filter((model) => model.agent_capability !== "h3_prompt_optimization");
            setDesignModels(available);
            setDesignModel((current) => current || available[0]?.api_model_id || "");
        }).catch(() => { if (active) setDesignModels([]); });
        return () => { active = false; };
    }, []);

    const refreshAssetIndex = useCallback(() => {
        const projectId = currentProject?.id;
        const requestId = ++assetIndexRequest.current;
        if (!projectId) {
            setAssetIndex([]);
            return;
        }
        void api.getAssetReferenceIndex(projectId)
            .then((index) => {
                if (requestId !== assetIndexRequest.current) return;
                const entries = index.assets.filter((entry) => entry.variants?.some((variant) => variant.id));
                setAssetIndex(entries);
                const available = new Set(entries.flatMap((entry) => entry.variants.map((variant) =>
                    `${entry.asset_type}:${entry.asset_id}:${variant.id}`)));
                setPromptPickerReferences((current) => Object.fromEntries(Object.entries(current).map(([panel, refs]) =>
                    [panel, refs.filter((ref) => available.has(referenceKey(ref)))])) as typeof current);
            })
            .catch(() => { if (requestId === assetIndexRequest.current) setAssetIndex([]); });
    }, [currentProject?.id]);

    useEffect(() => {
        setAssetIndex([]);
        refreshAssetIndex();
        return () => { assetIndexRequest.current++; };
    }, [refreshAssetIndex, assetIndexRevision]);

    useEffect(() => {
        setPromptReferences({ full_body: [], three_view: [], headshot: [] });
        setPromptPickerReferences({ full_body: [], three_view: [], headshot: [] });
        setPromptModes({ full_body: "text", three_view: "text", headshot: "text" });
    }, [asset.id]);

    const referenceCandidates = useMemo<ReferenceCandidate[]>(() => {
        const usedLabels = new Set<string>();
        const candidates: ReferenceCandidate[] = [];
        for (const entry of assetIndex) {
            const variants = entry.variants || [];
            variants.forEach((variant, index) => {
                if (!variant.id) return;
                const variantLabel = variant.display_name || variant.reference_view_role || variant.reference_distance || `未命名素材 ${index + 1}`;
                const baseLabel = variants.length > 1 || variant.display_name ? `${entry.name} · ${variantLabel}` : entry.name;
                let label = baseLabel;
                let suffix = 2;
                while (usedLabels.has(label)) label = `${baseLabel} ${suffix++}`;
                usedLabels.add(label);
                candidates.push({
                    label,
                    previewRef: { source_scope: entry.source_scope, source_container_id: entry.source_container_id,
                        asset_type: entry.asset_type, asset_id: entry.asset_id, variant_id: variant.id },
                    sourceLabel: [referenceScopeLabel(entry.source_scope), entry.source_name].filter(Boolean).join(" · "),
                    variantLabel,
                    description: entry.description,
                    reference: { asset_type: entry.asset_type, asset_id: entry.asset_id, variant_id: variant.id },
                });
            });
        }
        return candidates;
    }, [assetIndex]);

    // Mode state for Asset Activation v2 (Static/Motion)
    const [fullBodyMode, setFullBodyMode] = useState<'static' | 'motion'>('static');
    const [headshotMode, setHeadshotMode] = useState<'static' | 'motion'>('static');

    // Motion Ref prompts (initialized with PRD templates)
    const [fullBodyMotionPrompt, setFullBodyMotionPrompt] = useState('');
    const [headshotMotionPrompt, setHeadshotMotionPrompt] = useState('');

    // Motion Ref audio URLs
    const [fullBodyAudioUrl, setFullBodyAudioUrl] = useState('');
    const [headshotAudioUrl, setHeadshotAudioUrl] = useState('');
    const [isUploadingAudio, setIsUploadingAudio] = useState(false);

    // Motion Ref generation state
    const [isVideoLoading, setIsVideoLoading] = useState(false);


    // === Reverse Generation: Detect uploaded images ===
    const hasUploadedThreeViews = asset.three_view_asset?.variants?.some((v: any) => v.is_uploaded_source) || false;
    const hasUploadedHeadshot = asset.headshot_asset?.variants?.some((v: any) => v.is_uploaded_source) || false;
    const hasUploadedFullBody = asset.full_body_asset?.variants?.some((v: any) => v.is_uploaded_source) || false;
    const hasAnyUpload = hasUploadedThreeViews || hasUploadedHeadshot || hasUploadedFullBody;
    const hasNonFullBodyUpload = hasUploadedThreeViews || hasUploadedHeadshot;
    const hasReferenceSheetVariants = !!asset.reference_sheet?.image_variants?.length;
    const referenceSheetImageUrl = selectedReferenceSheetUrl(asset.reference_sheet);
    const referenceSheetImageAsset = hasReferenceSheetVariants
        ? { selected_id: asset.reference_sheet.selected_image_id, variants: asset.reference_sheet.image_variants }
        : undefined;
    // The canonical pool owns selection. A broken selected ID should not
    // silently show an unrelated legacy full-body image.
    const masterImageUrl = hasReferenceSheetVariants
        ? referenceSheetImageUrl
        : selectedVariantUrl(asset.full_body_asset, asset.full_body_image_url);
    const masterAsset = referenceSheetImageAsset || asset.full_body_asset;
    const masterGenerationType = referenceSheetImageAsset ? "reference_sheet" : "full_body";
    const hasFullBodyImage = !!masterImageUrl;

    // Local state for prompts
    const getInitialPrompt = (type: string, existingPrompt: string) => {
        const confirmedDesign = asset.character_design?.design_revisions?.at(-1)?.design;
        const confirmedNotes = confirmedDesignDescription(confirmedDesign);
        if (!confirmedNotes && existingPrompt) return existingPrompt;
        const promptDescription = confirmedNotes
            ? confirmedNotes
            : asset.description;

        if (type === "full_body") {
            return buildCharacterImagePrompt("full_body", asset.name, promptDescription, hasNonFullBodyUpload);
        }
        if (type === "three_view") {
            return buildCharacterImagePrompt("three_view", asset.name, promptDescription, hasFullBodyImage || hasAnyUpload);
        }
        if (type === "headshot") {
            return buildCharacterImagePrompt("headshot", asset.name, promptDescription, hasFullBodyImage || hasAnyUpload);
        }
        return "";
    };

    const [fullBodyPrompt, setFullBodyPrompt] = useState(getInitialPrompt("full_body", asset.full_body_prompt));
    const [threeViewPrompt, setThreeViewPrompt] = useState(getInitialPrompt("three_view", asset.three_view_prompt));
    const [headshotPrompt, setHeadshotPrompt] = useState(getInitialPrompt("headshot", asset.headshot_prompt));
    const [videoPrompt, setVideoPrompt] = useState(asset.video_prompt || "");
    const [promptsNeedDesignApply, setPromptsNeedDesignApply] = useState(
        Boolean(savedDesign.identity?.visual_notes || savedDesign.look?.visual_notes
            || Object.keys(savedDesign.identity?.features || {}).length || Object.keys(savedDesign.look?.features || {}).length) && !savedDesign.confirmed,
    );

    // New State for Style Control
    // User's own negative prompt (initially empty or with sensible defaults)
    const [negativePrompt, setNegativePrompt] = useState(DEFAULT_CHARACTER_NEGATIVE_PROMPT);

    const projectedIdentity = characterSectionText(identityFeatures, IDENTITY_FIELDS.map(([key]) => key), designNotes);
    const projectedLook = characterSectionText(lookFeatures, LOOK_FIELDS.map(([key]) => key), lookNotes);
    const requirementsToReview = ([
        ["身份", userVisualRequirements.identity, projectedIdentity],
        ["造型", userVisualRequirements.look, projectedLook],
    ] as const).filter(([, requirement, projected]) => requirementNeedsReview(requirement, projected));
    const currentDesignDescription = designPromptDescription(
        projectedIdentity,
        projectedLook,
        [...Object.values(designFieldAnswers), ...designScopeDescription(designRoute, designAgeStage)],
    );

    const applyDesignToPrompts = () => {
        setFullBodyPrompt(buildCharacterImagePrompt("full_body", asset.name, currentDesignDescription, hasNonFullBodyUpload));
        setThreeViewPrompt(buildCharacterImagePrompt("three_view", asset.name, currentDesignDescription, hasFullBodyImage || hasAnyUpload));
        setHeadshotPrompt(buildCharacterImagePrompt("headshot", asset.name, currentDesignDescription, hasFullBodyImage || hasAnyUpload));
        setPromptsNeedDesignApply(false);
    };
    const characterDesignRequest = {
        model: designModel,
        project_id: currentProject?.id,
        reference_assets: designReferences,
        character_name: asset.name,
        profile: asset.description,
        current_draft: designPromptDescription(
            characterSectionText(identityFeatures, IDENTITY_FIELDS.map(([key]) => key), designNotes),
            characterSectionText(lookFeatures, LOOK_FIELDS.map(([key]) => key), lookNotes)),
        user_visual_requirements: userVisualRequirements,
        user_answers: Object.fromEntries(Object.entries(designFieldAnswers).filter(([, answer]) => answer.trim())),
        route: designRoute,
        age_stage: designAgeStage,
        style: stylePrompt,
        confirmed_design: confirmedDesignDescription(asset.character_design?.design_revisions?.at(-1)?.design),
    };
    const characterDesignSource = JSON.stringify(characterDesignRequest);
    const characterDesignSourceRef = useRef(characterDesignSource);
    characterDesignSourceRef.current = characterDesignSource;
    useEffect(() => { setDesignReview(null); }, [characterDesignSource]);

    const generateDesignDraft = async () => {
        if (!designModel || designing) return;
        setDesigning(true);
        setDesignError("");
        setDesignReview(null);
        try {
            const source = characterDesignSource;
            const preview = await agentRequest<{ messages: VideoPolishMessages; media: { label: string; url: string }[];
                review_token: string; format_note: string }>("/character-design/draft/preview", "POST", characterDesignRequest);
            if (characterDesignSourceRef.current === source) setDesignReview({
                source, request: characterDesignRequest, messages: preview.messages, media: preview.media,
                reviewToken: preview.review_token, formatNote: preview.format_note,
            });
        } catch (error) {
            setDesignError(error instanceof Error ? error.message : "预览角色设计输入失败，请重试。");
        } finally {
            setDesigning(false);
        }
    };

    const confirmDesignDraft = async () => {
        const review = designReview;
        if (!review) return;
        if (review.source !== characterDesignSourceRef.current) {
            setDesignReview(null);
            setDesignError("角色输入已变化，请重新预览。");
            return;
        }
        setDesigning(true);
        setDesignError("");
        try {
            const result = await agentRequest<{
                identity: { visual_notes: string; features?: IdentityFeatures; basis?: string | string[] };
                look: { visual_notes: string; features?: LookFeatures; basis?: string | string[] };
                unresolved: string[];
                field_suggestions?: Record<string, string>;
                field_suggestion_choices?: Record<string, { age_stage?: string; route?: string }>;
                skill_revision: string;
            }>("/character-design/draft", "POST", {
                ...review.request, reviewed_messages: review.messages, review_token: review.reviewToken,
            });
            setDesignReview(null);
            if (review.source !== characterDesignSourceRef.current) return;
            const nextIdentity = preserveVisualRequirement(result.identity.visual_notes, userVisualRequirements.identity);
            const nextLook = preserveVisualRequirement(result.look.visual_notes, userVisualRequirements.look);
            const nextIdentityFeatures = normalizeCharacterFeatures(result.identity.features, IDENTITY_FIELDS.map(([key]) => key));
            const nextLookFeatures = normalizeCharacterFeatures(result.look.features, LOOK_FIELDS.map(([key]) => key));
            setDesignNotes(nextIdentity);
            setLookNotes(nextLook);
            setIdentityFeatures(nextIdentityFeatures);
            setLookFeatures(nextLookFeatures);
            setShowIdentityFields(true);
            setShowLookFields(true);
            setDesignIdentityBasis(userVisualRequirements.identity.trim()
                ? Array.from(new Set([...normalizeDesignBasis(result.identity.basis), "user_specified" as const]))
                : normalizeDesignBasis(result.identity.basis));
            setDesignLookBasis(userVisualRequirements.look.trim()
                ? Array.from(new Set([...normalizeDesignBasis(result.look.basis), "user_specified" as const]))
                : normalizeDesignBasis(result.look.basis));
            const questions = actionableDesignQuestions(result.unresolved, designFieldAnswers, result.field_suggestions);
            setDesignFieldSuggestions(Object.fromEntries(
                Object.entries(result.field_suggestions || {}).filter(([question, suggestion]) => questions.includes(question) && !!suggestion.trim()),
            ));
            setDesignFieldSuggestionChoices(Object.fromEntries(
                Object.entries(result.field_suggestion_choices || {}).filter(([question]) => questions.includes(question)),
            ));
            setDesignUnresolved(questions);
            setDesignFieldAnswers((current) => Object.fromEntries(
                Object.entries(current).filter(([question]) => questions.includes(question)),
            ));
            setDesignSource(
                [...normalizeDesignBasis(result.identity.basis), ...normalizeDesignBasis(result.look.basis)].includes("creative_choice")
                    ? "creative-choice"
                    : "stated",
            );
            setDesignSkillRevision(result.skill_revision);
            setDesignStatus("draft");
            setPromptsNeedDesignApply(true);
        } catch (error) {
            setDesignError(error instanceof Error ? error.message : "生成视觉草稿失败，请重试。");
        } finally {
            setDesigning(false);
        }
    };

    const saveDesignDraft = async (confirmed: boolean) => {
        if (!onUpdateAttributes || savingDesign) return;
        if (confirmed && !characterSectionText(identityFeatures, IDENTITY_FIELDS.map(([key]) => key), designNotes)) {
            setDesignError("请先填写具体的角色视觉值，再确认设计。 ");
            return;
        }
        const unanswered = designUnresolved.filter((question) => !designFieldAnswers[question]?.trim());
        const draft: DesignDraft = {
            route: designRoute,
            age_stage: designAgeStage || undefined,
            identity: { visual_notes: designNotes || undefined, features: identityFeatures, basis: designIdentityBasis },
            look: { route: designRoute, visual_notes: lookNotes || undefined, features: lookFeatures, basis: designLookBasis },
            unresolved: designNotes ? unanswered : [],
            field_answers: Object.fromEntries(Object.entries(designFieldAnswers).filter(([, answer]) => answer.trim())),
            user_visual_requirements: userVisualRequirements,
            field_suggestions: Object.fromEntries(Object.entries(designFieldSuggestions).filter(([question]) => !designFieldAnswers[question]?.trim())),
            field_suggestion_choices: Object.fromEntries(Object.entries(designFieldSuggestionChoices).filter(([question]) => !designFieldAnswers[question]?.trim())),
            reference_assets: designReferences,
            field_status: { route: "stated", age_stage: designAgeStage ? "stated" : "default", visual_notes: designNotes ? designSource : "default" },
            skill_id: "character-style-routes",
            skill_revision: designSkillRevision || undefined,
            confirmed,
        };
        setSavingDesign(true);
        setDesignError("");
        try {
            await onUpdateAttributes({ character_design: draft });
            setDesignUnresolved(draft.unresolved || []);
            setDesignStatus(confirmed ? "confirmed" : "draft");
            if (confirmed) {
                setDesignRevision((revision) => revision + 1);
            }
            setPromptsNeedDesignApply(true);
        } catch (error) {
            setDesignError(error instanceof Error ? error.message : "保存视觉设计失败，请重试。");
        } finally {
            setSavingDesign(false);
        }
    };
    // Art Direction Style expanded state (collapsed by default to save space)
    const [showStyleExpanded, setShowStyleExpanded] = useState(false);
    // Get the uploaded image URL for reverse generation reference
    const getUploadedReferenceUrl = () => {
        if (hasUploadedThreeViews) {
            const uploadedVariant = asset.three_view_asset?.variants?.find((v: any) => v.is_uploaded_source);
            return uploadedVariant?.url || asset.three_view_image_url;
        }
        if (hasUploadedHeadshot) {
            const uploadedVariant = asset.headshot_asset?.variants?.find((v: any) => v.is_uploaded_source);
            return uploadedVariant?.url || asset.headshot_image_url;
        }
        return null;
    };

    // Motion Ref generation handler with validation
    const handleGenerateMotionRef = async (assetType: 'full_body' | 'head_shot', prompt: string, audioUrl?: string) => {
        if (!onGenerateVideo) return;

        // Check if source image exists
        const hasSourceImage = assetType === 'full_body'
            ? hasFullBodyImage
            : (asset.headshot_image_url || asset.headshot_asset?.variants?.length > 0);

        if (!hasSourceImage) {
            alert(tc('generateFirstStatic', { type: assetType === 'full_body' ? tc('fullBodyType') : tc('avatarType') }));
            return;
        }

        setIsVideoLoading(true); // Start loading state (will be reset by onCanPlay or if no video)
        onGenerateVideo(prompt, 5, assetType);
    };


    // Audio upload handler for Motion Ref
    const handleAudioUpload = async (file: File, assetType: 'full_body' | 'head_shot') => {
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('audio/')) {
            alert(tc('invalidAudioFile'));
            return;
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            alert(tc('audioTooLarge'));
            return;
        }

        setIsUploadingAudio(true);

        try {
            const result = await api.uploadFile(file);
            const url = result.url;

            if (assetType === 'full_body') {
                setFullBodyAudioUrl(url);
                // Automatically update prompt if it's the default "counting" one
                const currentDefault = buildCharacterMotionPrompt('full_body', asset.description, false);
                const oldDefault = `Full-body character reference video.\n${asset.description}.\nStanding pose, shifting weight slightly, natural hand gestures while talking, turning body 30 degrees left and right to show costume details. No walking away.\nHead to toe shot, stable camera, flat lighting.`;

                if (fullBodyMotionPrompt === currentDefault || fullBodyMotionPrompt === oldDefault || !fullBodyMotionPrompt) {
                    setFullBodyMotionPrompt(buildCharacterMotionPrompt('full_body', asset.description, true));
                }
            } else {
                setHeadshotAudioUrl(url);
                // Automatically update prompt if it's the default "counting" one
                const currentDefault = buildCharacterMotionPrompt('headshot', asset.description, false);
                const oldDefault = `High-fidelity portrait video reference.\n${asset.description}.\nFacing camera, speaking naturally matching the audio, subtle head movements, blinking, rich micro-expressions.\n4k, studio lighting, stable camera.`;

                if (headshotMotionPrompt === currentDefault || headshotMotionPrompt === oldDefault || !headshotMotionPrompt) {
                    setHeadshotMotionPrompt(buildCharacterMotionPrompt('headshot', asset.description, true));
                }
            }
        } catch (error: any) {
            console.error('Failed to upload audio:', error);
            alert(tc('audioUploadFailed', { error: error.message }));
        } finally {
            setIsUploadingAudio(false);
        }
    };

    // PRD Motion Prompt Templates
    const getMotionDefault = (type: 'full_body' | 'headshot', hasAudio: boolean) => {
        return buildCharacterMotionPrompt(type, asset.description, hasAudio);
    };

    // Initialize prompts if empty (first time load)
    useEffect(() => {
        if (!fullBodyPrompt) {
            setFullBodyPrompt(getInitialPrompt("full_body", ""));
        }
        if (!threeViewPrompt) {
            setThreeViewPrompt(getInitialPrompt("three_view", ""));
        }
        if (!headshotPrompt) {
            setHeadshotPrompt(getInitialPrompt("headshot", ""));
        }
        if (!videoPrompt) {
            setVideoPrompt(buildCharacterVideoPrompt(asset.name, asset.description));
        }

        if (!fullBodyMotionPrompt) {
            setFullBodyMotionPrompt(getMotionDefault('full_body', !!fullBodyAudioUrl));
        }
        if (!headshotMotionPrompt) {
            setHeadshotMotionPrompt(getMotionDefault('headshot', !!headshotAudioUrl));
        }
    }, [asset.name, asset.description]);

    const handleResetMotionPrompt = (type: 'full_body' | 'headshot') => {
        const hasAudio = type === 'full_body' ? !!fullBodyAudioUrl : !!headshotAudioUrl;
        const defaultPrompt = getMotionDefault(type, hasAudio);
        if (type === 'full_body') {
            setFullBodyMotionPrompt(defaultPrompt);
        } else {
            setHeadshotMotionPrompt(defaultPrompt);
        }
    };


    // Update local state when asset updates (e.g. after generation)
    useEffect(() => {
        const hasConfirmedDesign = !!asset.character_design?.design_revisions?.at(-1)?.design;
        if (!hasConfirmedDesign && asset.full_body_prompt) setFullBodyPrompt(asset.full_body_prompt);
        else if (!hasConfirmedDesign && hasNonFullBodyUpload && !hasCharacterReferenceConstraint(fullBodyPrompt)) {
            setFullBodyPrompt(getInitialPrompt("full_body", ""));
        }

        if (!hasConfirmedDesign && asset.three_view_prompt) setThreeViewPrompt(asset.three_view_prompt);
        else if (!hasConfirmedDesign && hasAnyUpload && !hasCharacterReferenceConstraint(threeViewPrompt)) {
            setThreeViewPrompt(getInitialPrompt("three_view", ""));
        }

        if (!hasConfirmedDesign && asset.headshot_prompt) setHeadshotPrompt(asset.headshot_prompt);
        else if (!hasConfirmedDesign && hasAnyUpload && !hasCharacterReferenceConstraint(headshotPrompt)) {
            setHeadshotPrompt(getInitialPrompt("headshot", ""));
        }

        if (asset.video_prompt) setVideoPrompt(asset.video_prompt);
    }, [asset, hasAnyUpload, hasNonFullBodyUpload]);

    const handleGenerateClick = (type: "reference_sheet" | "full_body" | "three_view" | "headshot", batchSize: number) => {
        let prompt = "";
        if (type === "full_body" || type === "reference_sheet") prompt = fullBodyPrompt;
        else if (type === "three_view") prompt = threeViewPrompt;
        else if (type === "headshot") prompt = headshotPrompt;

        const promptType = type === "reference_sheet" ? "full_body" : type;
        const references = [...promptReferences[promptType], ...promptPickerReferences[promptType]]
            .filter((reference, index, all) => all.findIndex((candidate) => referenceKey(candidate) === referenceKey(reference)) === index);
        const imageGenerationMode = promptModes[promptType];
        if (imageGenerationMode === "reference" && references.length === 0) {
            toast.warning("Add at least one explicit @ reference before generating.");
            return;
        }
        if (imageGenerationMode === "text" && references.length > 0) {
            toast.warning("This prompt contains @ references. Select Reference image mode before generating.");
            return;
        }
        if ((type === "three_view" || type === "headshot") &&
            (imageGenerationMode !== "reference" || references.length !== 1)) {
            toast.warning("Select exactly one master image in Reference image mode for this character view.");
            return;
        }
        if (!currentProject?.id || !prompt.trim()) {
            toast.warning("Review a non-empty image prompt before generating.");
            return;
        }
        const isDerived = type === "three_view" || type === "headshot";
        setPendingImageReview({
            asset_id: asset.id,
            asset_type: "character",
            generation_type: type,
            prompt,
            negative_prompt: negativePrompt,
            batch_size: batchSize,
            model_name: currentProject.series_id ? undefined : resolveAssetGenerationModel(currentProject.model_settings?.t2i_model),
            image_generation_mode: imageGenerationMode,
            ...(isDerived ? { reference: references[0] } : { references }),
            apply_style: false,
            preserve_prompt: true,
        });
    };

    const setPanelReferences = (type: "full_body" | "three_view" | "headshot", references: AssetLibraryReference[]) => {
        setPromptReferences((current) => ({ ...current, [type]: references }));
    };

    const setPanelPickerReferences = (type: "full_body" | "three_view" | "headshot", references: AssetLibraryReference[]) => {
        setPromptPickerReferences((current) => ({ ...current, [type]: references }));
    };

    const reuseDesignReferencesForFullBody = () => {
        const available = new Set(referenceCandidates.map((candidate) => referenceKey(candidate.reference)));
        const references = designReferences.filter((reference) => available.has(referenceKey(reference)));
        if (references.length === 0) {
            toast.warning("设计参考图已不在当前项目可用素材中，请重新选择。");
            return;
        }
        setPanelPickerReferences("full_body", references);
        setPanelMode("full_body", "reference");
        toast.success(`已将 ${references.length} 张设计参考图选为全身出图参考；生成前请核对图片审核。`);
    };


    const setPanelMode = (type: "full_body" | "three_view" | "headshot", mode: "text" | "reference") => {
        setPromptModes((current) => ({ ...current, [type]: mode }));
    };

    // Helper to check if a specific type is generating
    const getGeneratingInfo = (type: string) => {
        if (!Array.isArray(generatingTypes) || generatingTypes.length === 0) {
            return { isGenerating: false, batchSize: 1 };
        }
        const task = generatingTypes.find(t => t?.type === type || t?.type === "all");
        return task ? { isGenerating: true, batchSize: task.batchSize || 1 } : { isGenerating: false, batchSize: 1 };
    };

    const handleSelectVariant = (type: "reference_sheet" | "full_body" | "three_view" | "headshot", variantId: string) => {
        if (!currentProject) return;
        const version = ++selectionVersion.current;
        const operation = selectionQueue.current.then(async () => {
            const updatedProject = await api.selectAssetVariant(currentProject.id, asset.id, "character", variantId, type);
            if (version === selectionVersion.current) updateProject(currentProject.id, updatedProject);
        });
        selectionQueue.current = operation.catch(() => {});
        return operation.catch((error) => {
            console.error("Failed to select variant:", error);
            throw error;
        });
    };

    const handleDeleteVariant = async (type: "reference_sheet" | "full_body" | "three_view" | "headshot", variantId: string) => {
        if (!currentProject) return;

        try {
            await selectionQueue.current;
            const updatedProject = await api.deleteAssetVariant(currentProject.id, asset.id, "character", variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete variant:", error);
            throw error;
        }
    };

    const handleFavoriteVariant = async (type: "reference_sheet" | "full_body" | "three_view" | "headshot", variantId: string, isFavorited: boolean) => {
        if (!currentProject) return;

        try {
            const updatedProject = await api.favoriteAssetVariant(currentProject.id, asset.id, "character", variantId, isFavorited, type);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to favorite variant:", error);
        }
    };

    const handleRenameVariant = async (variantId: string, displayName: string) => {
        if (!currentProject) return;
        const updatedProject = await api.updateAssetVariantMetadata(currentProject.id, asset.id, "character", variantId, undefined, undefined, displayName);
        updateProject(currentProject.id, updatedProject);
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-md p-4 md:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface border border-glass-border rounded-lg w-full max-w-7xl h-[min(92dvh,920px)] flex flex-col overflow-hidden shadow-lg"
            >
                <div className="relative z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-glass-border bg-surface px-4 md:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        <div role="heading" aria-level={2} className="min-w-0 text-lg font-bold text-foreground md:text-xl"><AssetNameEditor key={asset.id} name={asset.name} onRename={onRename} className="font-bold" /></div>
                        <span className="hidden shrink-0 text-sm text-text-muted sm:inline">{tc("workbench")}</span>
                        <div className="hidden shrink-0 items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full lg:flex">
                            <span className="text-xs text-blue-400 font-medium">{tc("tipConsistency")}</span>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {planEntries.length > 0 && (
                            <button type="button" aria-expanded={isPlanOpen} aria-controls="character-plan-constraints" onClick={() => setIsPlanOpen(open => !open)} className="flex items-center gap-1 rounded border border-glass-border px-2 py-1.5 text-xs text-text-secondary hover:text-foreground" title="拍摄计划约束">
                                拍摄计划 · {planEntries.length} 条
                                {isPlanOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 hover:bg-hover-bg rounded-full text-text-secondary hover:text-foreground transition-colors" aria-label="关闭角色工作台">
                            <X size={24} />
                        </button>
                    </div>
                    {isPlanOpen && planEntries.length > 0 && (
                        <div id="character-plan-constraints" className="absolute right-3 top-full z-50 max-h-[45vh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto border border-glass-border bg-surface shadow-lg md:right-6">
                            <EpisodeAssetPlanPanel entries={planEntries} title="拍摄计划关联场景（仅供核对）" />
                        </div>
                    )}
                </div>

                <div className="lg:hidden border-b border-glass-border px-4 py-2">
                    <button type="button" onClick={() => setShowProfile(current => !current)} aria-label={tc("dossier")} title={tc("dossier")} aria-expanded={showProfile} className="flex min-h-10 items-center gap-2 text-sm text-text-secondary hover:text-foreground">
                        <PanelLeft size={18} />{tc("dossier")}
                        {designUnresolved.length > 0 && <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[11px] text-amber-300">{tc("pendingDesignQuestions", { count: designUnresolved.length })}</span>}
                    </button>
                </div>
                <div className="min-h-0 flex-1 flex flex-col lg:flex-row overflow-hidden">
                    <aside className={`${showProfile ? "block max-h-[45%]" : "hidden"} lg:block lg:max-h-none lg:w-80 xl:w-[340px] shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-glass-border bg-surface-inset p-4`} aria-label={tc("dossier")}>
                        <h3 className="text-sm font-semibold text-foreground">{tc("dossier")}</h3>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">{asset.description || tc("noDossier")}</p>
                        <section className="mt-5 border-t border-glass-border pt-4" aria-labelledby="character-visual-design-title">
                            <div className="flex items-center justify-between gap-2">
                                <h3 id="character-visual-design-title" className="text-sm font-semibold text-foreground">角色视觉设计</h3>
                                <span className={`text-[11px] ${designStatus === "confirmed" ? "text-emerald-400" : "text-text-muted"}`}>
                                    {designStatus === "confirmed" ? `已确认 r${designRevision}` : "草稿"}
                                </span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-text-muted">AI 会补全可创作的外观与造型细节，并标明创意选择；只有影响角色设定的关键歧义才需要核对。</p>
                            <label className="mt-3 block text-xs text-text-secondary" htmlFor="character-style-route">题材 / 画风</label>
                            <select id="character-style-route" value={designRoute} onChange={(event) => { setDesignRoute(event.target.value); setDesignStatus("draft"); setPromptsNeedDesignApply(true); }} className="mt-1 h-10 w-full rounded-md border border-glass-border bg-surface px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                <option value="realistic-modern">真人现代</option>
                                <option value="historical-costume">古装 / 武侠</option>
                                <option value="xianxia-fantasy">修仙 / 仙侠</option>
                                <option value="anime-stylized">动漫 / 国漫</option>
                            </select>
                            <label className="mt-3 block text-xs text-text-secondary" htmlFor="character-age-stage">年龄阶段</label>
                            <select id="character-age-stage" value={designAgeStage} onChange={(event) => { setDesignAgeStage(event.target.value); setDesignStatus("draft"); setPromptsNeedDesignApply(true); }} className="mt-1 h-10 w-full rounded-md border border-glass-border bg-surface px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                <option value="">未指定</option>
                                <option value="child">儿童</option>
                                <option value="teen">少年 / 少女</option>
                                <option value="young-adult">青年</option>
                                <option value="adult">成年人</option>
                                <option value="older-adult">老年</option>
                            </select>
                            <div className="mt-4 rounded-md border border-glass-border bg-surface/60 p-3">
                                <button type="button" aria-expanded={showIdentityFields} onClick={() => setShowIdentityFields((open) => !open)} className="flex min-h-10 w-full items-center justify-between gap-2 text-left text-xs font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                    <span>逐项编辑身份外观 · {Object.values(identityFeatures).filter((value) => value?.trim()).length}/{IDENTITY_FIELDS.length}</span>
                                    {showIdentityFields ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                                </button>
                                {showIdentityFields && <><p className="mt-1 text-[11px] leading-4 text-text-muted">这些字段优先编入角色图片提示词；留空的内容不会由系统补写。</p>
                                <div className="mt-2 space-y-2">
                                    {IDENTITY_FIELDS.map(([key, label]) => <label key={key} className="block text-xs text-text-secondary">
                                        {label}
                                        <textarea aria-label={`角色${label}`} value={identityFeatures[key] || ""} maxLength={500} rows={2}
                                            onChange={(event) => { setIdentityFeatures((current) => ({ ...current, [key]: event.target.value })); setDesignIdentityBasis(["user_specified"]); setDesignSource("stated"); setDesignStatus("draft"); setPromptsNeedDesignApply(true); }}
                                            className="mt-1 w-full resize-y rounded border border-glass-border bg-surface px-2 py-1.5 text-xs text-foreground" />
                                    </label>)}
                                </div></>}
                            </div>
                            <label className="mt-3 block text-xs text-text-secondary" htmlFor="character-visual-notes">身份视觉值</label>
                            <textarea id="character-visual-notes" value={designNotes} onChange={(event) => { setDesignNotes(event.target.value); setIdentityFeatures({}); setUserVisualRequirements(current => ({ ...current, identity: event.target.value })); setDesignIdentityBasis(["user_specified"]); setDesignSource("stated"); setDesignStatus("draft"); setPromptsNeedDesignApply(true); }} placeholder="可先写年龄感、面容、体态等要求；留空由 AI 设计。" rows={4} className="mt-1 w-full resize-y rounded-md border border-glass-border bg-surface px-3 py-2 text-sm leading-5 text-foreground placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
                            {Object.values(identityFeatures).some((value) => value?.trim()) && <p className="mt-1 text-[11px] text-text-muted">当前使用上方结构化字段；编辑本段会切回整段文本并清空上方字段。</p>}
                            {designSource === "creative-choice" && <p className="mt-1 text-xs text-amber-400">AI 创意设计选择，确认前请核对剧本与参考素材。</p>}
                            <div className="mt-4 rounded-md border border-glass-border bg-surface/60 p-3">
                                <button type="button" aria-expanded={showLookFields} onClick={() => setShowLookFields((open) => !open)} className="flex min-h-10 w-full items-center justify-between gap-2 text-left text-xs font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                    <span>逐项编辑造型 · {Object.values(lookFeatures).filter((value) => value?.trim()).length}/{LOOK_FIELDS.length}</span>
                                    {showLookFields ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                                </button>
                                {showLookFields && <><p className="mt-1 text-[11px] leading-4 text-text-muted">服装、配色和配件分别确认；武器未在剧本或用户要求中出现时可留空。</p>
                                <div className="mt-2 space-y-2">
                                    {LOOK_FIELDS.map(([key, label]) => <label key={key} className="block text-xs text-text-secondary">
                                        {label}
                                        <textarea aria-label={`角色${label}`} value={lookFeatures[key] || ""} maxLength={500} rows={2}
                                            onChange={(event) => { setLookFeatures((current) => ({ ...current, [key]: event.target.value })); setDesignLookBasis(["user_specified"]); setDesignStatus("draft"); setPromptsNeedDesignApply(true); }}
                                            className="mt-1 w-full resize-y rounded border border-glass-border bg-surface px-2 py-1.5 text-xs text-foreground" />
                                    </label>)}
                                </div></>}
                            </div>
                            <label className="mt-3 block text-xs text-text-secondary" htmlFor="character-look-notes">造型视觉值</label>
                            <textarea id="character-look-notes" value={lookNotes} onChange={(event) => { setLookNotes(event.target.value); setLookFeatures({}); setUserVisualRequirements(current => ({ ...current, look: event.target.value })); setDesignLookBasis(["user_specified"]); setDesignStatus("draft"); setPromptsNeedDesignApply(true); }} placeholder="可先写服装、鞋履、武器等要求；留空由 AI 设计。" rows={3} className="mt-1 w-full resize-y rounded-md border border-glass-border bg-surface px-3 py-2 text-sm leading-5 text-foreground placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
                            {Object.values(lookFeatures).some((value) => value?.trim()) && <p className="mt-1 text-[11px] text-text-muted">当前使用上方结构化字段；编辑本段会切回整段文本并清空上方字段。</p>}
                            <AssetReferencePicker
                                candidates={referenceCandidates}
                                selected={designReferences}
                                onChange={(references) => { setDesignReferences(references); setDesignStatus("draft"); }}
                                title="选择角色参考图"
                                description="可搜索本集、系列或全局素材；也可在下方图片 Prompt 输入 @ 选择。"
                            />
                            <label className="mt-3 block text-xs text-text-secondary" htmlFor="character-design-model">设计模型</label>
                            <div className="mt-1 flex gap-2">
                                <select id="character-design-model" value={designModel} onChange={(event) => setDesignModel(event.target.value)} disabled={!designModels.length || designing} className="h-10 min-w-0 flex-1 rounded-md border border-glass-border bg-surface px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                    {!designModels.length && <option value="">暂无可用模型</option>}
                                    {designModels.map((model) => <option key={model.api_model_id} value={model.api_model_id}>{model.display_name}</option>)}
                                </select>
                                <button type="button" disabled={!designModel || designing || !asset.description} onClick={() => void generateDesignDraft()} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-glass-border px-3 text-sm text-foreground hover:bg-hover-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Sparkles size={15} />{designing ? "设计中" : "生成草稿"}</button>
                            </div>
                            {designReview && <div className="mt-3"><VideoPolishReview
                                messages={designReview.messages} media={designReview.media} formatNote={designReview.formatNote}
                                isContextIr={false} isSubmitting={designing} error={designError}
                                userLabel="角色档案与视觉要求" confirmLabel="确认输入并生成角色草稿"
                                onChange={messages => setDesignReview(current => current && ({ ...current, messages }))}
                                onCancel={() => setDesignReview(null)} onConfirm={() => void confirmDesignDraft()} /></div>}
                            {designUnresolved.length > 0 && (
                                <section className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/5 p-3" aria-labelledby="character-design-unresolved-title">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <h4 id="character-design-unresolved-title" className="text-xs font-medium text-foreground">待核对 · {designUnresolved.length}</h4>
                                            <p className="mt-1 text-[11px] leading-4 text-text-muted">只有关键设定歧义才会列在这里。可以采用 Agent 建议，也可以改成自己的方案。</p>
                                        </div>
                                        <span className="text-[11px] text-amber-300">{designUnresolved.filter((item) => designFieldAnswers[item]?.trim()).length}/{designUnresolved.length} 已回答</span>
                                    </div>
                                    <div className="mt-2 space-y-2">
                                        {designUnresolved.map((question, index) => {
                                            const fieldId = `character-design-answer-${index}`;
                                            const suggestion = designFieldSuggestions[question];
                                            const answer = designFieldAnswers[question] || "";
                                            return (
                                                <label key={`${question}-${index}`} htmlFor={fieldId} className="block rounded-md border border-glass-border bg-surface/60 p-2">
                                                    <span className="block text-xs leading-5 text-text-secondary">{question}</span>
                                                    {suggestion && <div className="mt-1 rounded border border-primary/20 bg-primary/5 p-2">
                                                        <span className="text-[10px] font-medium uppercase tracking-wide text-primary">Agent 建议</span>
                                                        <p className="mt-0.5 text-xs leading-5 text-foreground">{suggestion}</p>
                                                        <button
                                                            type="button"
                                                            disabled={answer === suggestion}
                                                            onClick={() => {
                                                                setDesignFieldAnswers((current) => ({ ...current, [question]: suggestion }));
                                                                const choice = designFieldSuggestionChoices[question];
                                                                if (choice?.age_stage) setDesignAgeStage(choice.age_stage);
                                                                if (choice?.route) setDesignRoute(choice.route);
                                                                setDesignStatus("draft");
                                                                setPromptsNeedDesignApply(true);
                                                            }}
                                                            className="mt-1 inline-flex min-h-8 items-center gap-1 rounded px-2 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                                                        >
                                                            <Check size={13} aria-hidden="true" />{answer === suggestion ? "已采用" : "采用此建议"}
                                                        </button>
                                                    </div>}
                                                    <textarea
                                                        id={fieldId}
                                                        value={answer}
                                                        onChange={(event) => { setDesignFieldAnswers((current) => ({ ...current, [question]: event.target.value })); setDesignStatus("draft"); setPromptsNeedDesignApply(true); }}
                                                        placeholder={suggestion ? "可直接修改建议，或留空稍后决定" : "补充你的决定；如果暂时无法决定可留空"}
                                                        rows={2}
                                                        className="mt-1 w-full resize-y rounded border border-glass-border bg-surface px-2 py-1.5 text-xs leading-5 text-foreground placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                                                    />
                                                </label>
                                            );
                                        })}
                                    </div>
                                </section>
                            )}
                            {designError && <p role="alert" className="mt-2 text-xs text-red-400">{designError}</p>}
                            <div className="mt-3 flex gap-2">
                                <button type="button" disabled={savingDesign || !onUpdateAttributes} onClick={() => void saveDesignDraft(false)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md border border-glass-border px-3 text-sm text-text-secondary hover:bg-hover-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Sparkles size={15} />保存草稿</button>
                                <button type="button" disabled={savingDesign || !onUpdateAttributes} onClick={() => void saveDesignDraft(true)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Check size={15} />确认设计</button>
                            </div>
                        </section>
                    </aside>

                    <div className="min-h-0 min-w-0 flex-1 flex flex-col">
                        {promptsNeedDesignApply && <div className="mx-3 mt-3 flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 sm:mx-5 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground">角色设计草稿尚未应用到图片提示词</p>
                                <p className="mt-0.5 text-[11px] leading-4 text-text-muted">应用会更新全身、三视图和肖像提示词，不保存角色设计或创建版本；之后仍可编辑提示词。</p>
                                {requirementsToReview.length > 0 && <div role="status" className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                                    <p>以下用户原话未逐字出现在结构化投影中。请核对上方字段与预览，必要时补回，再应用：</p>
                                    {requirementsToReview.map(([section, requirement]) => <p key={section}>{section}：{requirement}</p>)}
                                </div>}
                                <details className="mt-2 text-xs text-text-secondary">
                                    <summary className="cursor-pointer">查看将写入的三条图片提示词</summary>
                                    <div className="mt-2 space-y-2 whitespace-pre-wrap rounded border border-glass-border bg-surface-inset p-2 text-foreground">
                                        <p>全身：{buildCharacterImagePrompt("full_body", asset.name, currentDesignDescription, hasNonFullBodyUpload)}</p>
                                        <p>三视图：{buildCharacterImagePrompt("three_view", asset.name, currentDesignDescription, hasFullBodyImage || hasAnyUpload)}</p>
                                        <p>肖像：{buildCharacterImagePrompt("headshot", asset.name, currentDesignDescription, hasFullBodyImage || hasAnyUpload)}</p>
                                    </div>
                                </details>
                            </div>
                            <button type="button" onClick={() => applyDesignToPrompts()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                <Sparkles size={14} aria-hidden="true" />应用到图片提示词
                            </button>
                        </div>}
                        {activePanel === "full_body" && designReferences.length > 0 && <div className="mx-3 mt-3 flex flex-col gap-2 rounded-md border border-glass-border bg-surface-inset p-3 text-xs sm:mx-5 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-text-secondary">设计参考图 {designReferences.length} 张目前只用于 AI 草稿分析。出图可显式沿用，提交前仍可增删。</p>
                            <button type="button" onClick={reuseDesignReferencesForFullBody} className="min-h-10 shrink-0 rounded-md border border-glass-border px-3 text-foreground hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">沿用到全身出图</button>
                        </div>}
                        <div role="tablist" aria-label={tc("materialTypes")} className="flex shrink-0 gap-1 overflow-x-auto border-b border-glass-border px-3 sm:px-5">
                            {([ ["full_body", tc("masterAsset")], ["three_view", tc("threeViews")], ["headshot", tc("avatar")] ] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={activePanel === id} tabIndex={activePanel === id ? 0 : -1} onClick={() => setActivePanel(id)} onKeyDown={(event) => {
                                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                event.preventDefault();
                                const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') || []);
                                const next = tabs[(tabs.indexOf(event.currentTarget) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                                next?.click();
                                next?.focus();
                            }} className={`min-h-11 shrink-0 border-b-2 px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activePanel === id ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-foreground"}`}>{label}</button>)}
                        </div>
                        <div className="min-h-0 flex-1 flex overflow-hidden">

                    {/* Panel 1: Full Body (Master) */}
                    {activePanel === "full_body" &&
                    <WorkbenchPanel
                        assetScope={asset.id}
                        title={tc("masterAsset")}
                        isActive={activePanel === "full_body"}
                        onClick={() => setActivePanel("full_body")}

                        asset={masterAsset}
                        currentImageUrl={masterImageUrl}
                        onSelect={(id: string) => handleSelectVariant(masterGenerationType, id)}
                        onDelete={(id: string) => handleDeleteVariant(masterGenerationType, id)}
                        onFavorite={(id: string, isFav: boolean) => handleFavoriteVariant(masterGenerationType, id, isFav)}
                        onRename={handleRenameVariant}

                        prompt={fullBodyPrompt}
                        setPrompt={setFullBodyPrompt}
                        referenceCandidates={referenceCandidates}
                        onRefreshReferences={refreshAssetIndex}
                        onReferencesChange={(references: AssetLibraryReference[]) => setPanelReferences("full_body", references)}
                        showReferencePicker
                        pickerReferences={promptPickerReferences.full_body}
                        onPickerReferencesChange={(references: AssetLibraryReference[]) => setPanelPickerReferences("full_body", references)}
                        imageGenerationMode={promptModes.full_body}
                        onImageGenerationModeChange={(mode: "text" | "reference") => setPanelMode("full_body", mode)}
                        onGenerate={(batchSize: number) => handleGenerateClick(masterGenerationType, batchSize)}
                        isGenerating={getGeneratingInfo(masterGenerationType).isGenerating}
                        generatingBatchSize={getGeneratingInfo(masterGenerationType).batchSize}
                        description="The primary reference for character consistency."
                        aspectRatio="9:16"

                        // Reverse generation: Show hint if upload detected but no full body
                        reverseGenerationMode={hasNonFullBodyUpload && !hasFullBodyImage}
                        reverseReferenceUrl={getUploadedReferenceUrl()}

                        supportsMotion={true}
                        mode={fullBodyMode}
                        onModeChange={setFullBodyMode}
                        hasStaticImage={hasFullBodyImage}
                        motionRefVideos={asset.full_body?.video_variants || []}
                        onGenerateMotionRef={(prompt: string, audioUrl?: string) => handleGenerateMotionRef('full_body', prompt, audioUrl)}
                        isGeneratingMotion={generatingTypes.some(t => t.type === "video_full_body")}
                        motionPrompt={fullBodyMotionPrompt}
                        setMotionPrompt={setFullBodyMotionPrompt}
                        audioUrl={fullBodyAudioUrl}
                        onAudioUpload={(file: File) => handleAudioUpload(file, 'full_body')}
                        isUploadingAudio={isUploadingAudio}
                        isVideoLoading={isVideoLoading}
                        setIsVideoLoading={setIsVideoLoading}
                        onResetPrompt={() => handleResetMotionPrompt('full_body')}
                    />}

                    {/* Panel 2: Three View (Derived) */}
                    {activePanel === "three_view" &&
                    <WorkbenchPanel
                        assetScope={asset.id}
                        title={tc("threeViews")}
                        isActive={activePanel === "three_view"}
                        onClick={() => setActivePanel("three_view")}

                        asset={asset.three_view_asset}
                        currentImageUrl={asset.three_view_image_url}
                        onSelect={(id: string) => handleSelectVariant("three_view", id)}
                        onDelete={(id: string) => handleDeleteVariant("three_view", id)}
                        onFavorite={(id: string, isFav: boolean) => handleFavoriteVariant("three_view", id, isFav)}
                        onRename={handleRenameVariant}

                        prompt={threeViewPrompt}
                        setPrompt={setThreeViewPrompt}
                        referenceCandidates={referenceCandidates}
                        onRefreshReferences={refreshAssetIndex}
                        onReferencesChange={(references: AssetLibraryReference[]) => setPanelReferences("three_view", references)}
                        showReferencePicker
                        pickerReferences={promptPickerReferences.three_view}
                        onPickerReferencesChange={(references: AssetLibraryReference[]) => setPanelPickerReferences("three_view", references)}
                        imageGenerationMode={promptModes.three_view}
                        onImageGenerationModeChange={(mode: "text" | "reference") => setPanelMode("three_view", mode)}
                        onGenerate={(batchSize: number) => handleGenerateClick("three_view", batchSize)}
                        isGenerating={getGeneratingInfo("three_view").isGenerating}
                        generatingBatchSize={getGeneratingInfo("three_view").batchSize}
                        isLocked={!hasFullBodyImage && !hasAnyUpload}
                        description="Front, side, and back views for 3D-like consistency."
                        aspectRatio="16:9"
                    />}

                    {/* Panel 3: Headshot (Derived) */}
                    {activePanel === "headshot" &&
                    <WorkbenchPanel
                        assetScope={asset.id}
                        title={tc("avatar")}
                        isActive={activePanel === "headshot"}
                        onClick={() => setActivePanel("headshot")}

                        asset={asset.headshot_asset}
                        currentImageUrl={asset.headshot_image_url || asset.avatar_url}
                        onSelect={(id: string) => handleSelectVariant("headshot", id)}
                        onDelete={(id: string) => handleDeleteVariant("headshot", id)}
                        onFavorite={(id: string, isFav: boolean) => handleFavoriteVariant("headshot", id, isFav)}
                        onRename={handleRenameVariant}

                        prompt={headshotPrompt}
                        setPrompt={setHeadshotPrompt}
                        referenceCandidates={referenceCandidates}
                        onRefreshReferences={refreshAssetIndex}
                        onReferencesChange={(references: AssetLibraryReference[]) => setPanelReferences("headshot", references)}
                        showReferencePicker
                        pickerReferences={promptPickerReferences.headshot}
                        onPickerReferencesChange={(references: AssetLibraryReference[]) => setPanelPickerReferences("headshot", references)}
                        imageGenerationMode={promptModes.headshot}
                        onImageGenerationModeChange={(mode: "text" | "reference") => setPanelMode("headshot", mode)}
                        onGenerate={(batchSize: number) => handleGenerateClick("headshot", batchSize)}
                        isGenerating={getGeneratingInfo("headshot").isGenerating}
                        generatingBatchSize={getGeneratingInfo("headshot").batchSize}
                        isLocked={!hasFullBodyImage && !hasAnyUpload}
                        description="Close-up facial details and expressions."
                        aspectRatio="1:1"

                        supportsMotion={true}
                        mode={headshotMode}
                        onModeChange={setHeadshotMode}
                        hasStaticImage={!!asset.headshot_image_url || (asset.headshot_asset?.variants?.length > 0)}
                        motionRefVideos={asset.head_shot?.video_variants || []}
                        onGenerateMotionRef={(prompt: string, audioUrl?: string) => handleGenerateMotionRef('head_shot', prompt, audioUrl)}
                        isGeneratingMotion={generatingTypes.some(t => t.type === "video_head_shot")}
                        motionPrompt={headshotMotionPrompt}
                        setMotionPrompt={setHeadshotMotionPrompt}
                        audioUrl={headshotAudioUrl}
                        onAudioUpload={(file: File) => handleAudioUpload(file, 'head_shot')}
                        isUploadingAudio={isUploadingAudio}
                        isVideoLoading={isVideoLoading}
                        setIsVideoLoading={setIsVideoLoading}
                        onResetPrompt={() => handleResetMotionPrompt('headshot')}
                    />}
                        </div>
                    </div>
                </div>

                <details className="shrink-0 border-t border-glass-border bg-surface">
                    <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-text-secondary hover:text-foreground sm:px-6">{tc("advancedSettings")}</summary>
                    <div className="max-h-[30vh] overflow-y-auto">
                {/* Footer: Negative Prompt & Art Direction Settings */}
                <div className="border-t border-glass-border bg-surface flex flex-col">
                    {/* Top Row: User's Negative Prompt + Apply Style Toggle */}
                    <div className="px-6 py-3 flex items-start gap-4">
                        {/* User's Negative Prompt (Editable) */}
                        <div className="flex-1">
                            <label className="text-xs font-bold text-text-muted uppercase mb-2 block">{tc("workbench")}</label>
                            <textarea
                                value={negativePrompt}
                                onChange={(e) => setNegativePrompt(e.target.value)}
                                className="w-full h-16 bg-input-bg border border-glass-border rounded-lg p-3 text-xs text-text-secondary resize-none focus:outline-none focus:border-primary/50 font-mono"
                                placeholder="Enter your negative prompt (avoid unwanted elements)..."
                            />
                        </div>

                        {/* Copy style into the editable prompts before submitting. */}
                        <div className="pt-6">
                            <div className="flex items-center gap-2 bg-surface px-4 py-2 rounded-lg border border-glass-border">
                                <button type="button" disabled={activePanel === "video" || (!stylePrompt && !styleNegativePrompt)} onClick={() => {
                                    if (activePanel === "full_body") setFullBodyPrompt((current) => includeVisibleStyle(current, stylePrompt));
                                    if (activePanel === "three_view") setThreeViewPrompt((current) => includeVisibleStyle(current, stylePrompt));
                                    if (activePanel === "headshot") setHeadshotPrompt((current) => includeVisibleStyle(current, stylePrompt));
                                    setNegativePrompt((current) => includeVisibleStyle(current, styleNegativePrompt));
                                }} className="text-xs font-bold text-text-secondary disabled:opacity-40">
                                    {tc("copyStyleToPrompt")}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Optional style source; generation uses only the edited prompt fields. */}
                    {(stylePrompt || styleNegativePrompt) && (
                        <div className="border-t border-border-subtle">
                            <button
                                onClick={() => setShowStyleExpanded(!showStyleExpanded)}
                                className="w-full px-6 py-2 flex items-center justify-between hover:bg-glass transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500" />
                                    <span className="text-xs font-bold text-text-secondary uppercase">Art Direction Style (Copy to Prompt Above)</span>
                                </div>
                                <ChevronRight size={14} className={`text-text-muted transform transition-transform ${showStyleExpanded ? 'rotate-90' : ''}`} />
                            </button>

                            <AnimatePresence>
                                {showStyleExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="px-6 pb-4">
                                            <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-glass-border rounded-lg p-4">
                                                {stylePrompt && (
                                                    <div className="mb-3">
                                                        <span className="text-xs font-bold text-green-400 block mb-1">+ Style Prompt:</span>
                                                        <p className="text-xs text-text-secondary font-mono bg-surface p-2 rounded border border-border-subtle leading-relaxed">
                                                            {stylePrompt}
                                                        </p>
                                                    </div>
                                                )}

                                                {styleNegativePrompt && (
                                                    <div>
                                                        <span className="text-xs font-bold text-red-400 block mb-1">+ Negative Prompt:</span>
                                                        <p className="text-xs text-text-secondary font-mono bg-surface p-2 rounded border border-border-subtle leading-relaxed">
                                                            {styleNegativePrompt}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
                    </div>
                </details>
            </motion.div>
            {pendingImageReview && currentProject?.id && <AssetImageSubmissionReview
                projectId={currentProject.id}
                request={pendingImageReview}
                onBack={() => setPendingImageReview(null)}
                onConfirm={(review) => {
                    const request = pendingImageReview;
                    setPendingImageReview(null);
                    onGenerate(request.generation_type, request.prompt, false, request.negative_prompt,
                        request.batch_size, request.reference ? [request.reference] : request.references || [],
                        request.image_generation_mode, review.fingerprint);
                }}
            />}
        </div>
    );
}

export function WorkbenchPanel({
    title,
    assetScope,
    isActive,
    onClick,

    // Variant Props
    asset,
    currentImageUrl,
    onSelect,
    onDelete,
    onFavorite,
    onRename,

    prompt,
    setPrompt,
    referenceCandidates = [],
    onRefreshReferences,
    onReferencesChange,
    showReferencePicker = false,
    pickerReferences = [],
    onPickerReferencesChange,
    imageGenerationMode = "text",
    onImageGenerationModeChange,
    onGenerate,
    isGenerating,
    generatingBatchSize,
    status,
    isLocked,
    description,
    aspectRatio = "9:16",
    // Video specific
    isVideo = false,
    videos,
    onDeleteVideo,
    onGenerateVideo,

    // Motion Ref Mode (Asset Activation v2)
    supportsMotion = false,
    mode = 'static',  // 'static' | 'motion'
    onModeChange,
    hasStaticImage = false,
    motionRefVideos = [],
    onGenerateMotionRef,
    isGeneratingMotion = false,
    motionPrompt = '',
    setMotionPrompt,
    audioUrl = '',
    onAudioUpload,
    isUploadingAudio = false,
    isVideoLoading = false,
    setIsVideoLoading,
    onResetPrompt,
    // Reverse Generation Props
    reverseGenerationMode = false,
    reverseReferenceUrl = null
}: any) {
    const tc = useTranslations("character");
    const ti = useTranslations("imageEditor");
    const currentProject = useProjectStore((state) => state.currentProject);
    const [mention, setMention] = useState<ReferenceSuggestion | null>(null);
    const mentionQuery = mention?.query.toLocaleLowerCase() ?? "";
    const matchingReferenceCandidates = referenceCandidates.filter((candidate: ReferenceCandidate) =>
        [candidate.label, candidate.description, candidate.sourceLabel, candidate.variantLabel]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(mentionQuery)),
    );

    return (
        <div
            className={`min-w-0 min-h-0 flex-1 flex flex-col transition-colors ${isActive ? 'bg-glass' : 'bg-transparent hover:bg-hover-bg'}`}
            onClick={onClick}
        >
            {/* Panel Header */}
            <div className="p-4 border-b border-border-subtle">
                <div className="flex items-center justify-between mb-1">
                    <h3 className={`font-bold text-sm uppercase tracking-wider ${isActive ? 'text-primary' : 'text-text-secondary'}`}>
                        {title}
                    </h3>

                    {/* Mode Switcher (Asset Activation v2) */}
                    {supportsMotion && (
                        <div className="flex items-center gap-1 bg-surface p-1 rounded-lg border border-glass-border">
                            <button
                                onClick={(e) => { e.stopPropagation(); onModeChange?.('static'); }}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${mode === 'static'
                                    ? 'bg-primary/20 text-primary'
                                    : 'text-text-secondary hover:text-foreground'
                                    }`}
                            >
                                <PhotoIcon size={12} />
                                Static
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!hasStaticImage) {
                                        alert(tc('generateFirstStatic', { type: tc('fullBodyType') }));
                                        return;
                                    }
                                    onModeChange?.('motion');
                                }}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${mode === 'motion'
                                    ? 'bg-purple-500/20 text-purple-400'
                                    : 'text-text-secondary hover:text-foreground'
                                    }`}
                            >
                                <Video size={12} />
                                {tc("motionMode")}
                            </button>
                        </div>
                    )}
                </div>
                <p className="text-xs text-text-muted">{description}</p>
            </div>

            {/* Image Area with Variant Selector */}
            <div className="flex-1 relative bg-surface p-4 flex flex-col overflow-y-auto group">

                {/* Locked Overlay */}
                {isLocked && (
                    <div className="absolute inset-0 bg-overlay z-20 flex items-center justify-center text-center p-6">
                        <div className="text-text-muted flex flex-col items-center gap-2">
                            <Lock size={32} />
                            <span className="text-sm">Generate Master Asset first</span>
                        </div>
                    </div>
                )}

                {/* Reverse Generation Hint - shown in Full Body panel when upload detected */}
                {reverseGenerationMode && (
                    <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent z-10 flex flex-col items-center justify-center text-center p-6 pointer-events-none">
                        <div className="flex flex-col items-center gap-3 bg-overlay backdrop-blur-md rounded-xl p-6 border border-primary/30 pointer-events-auto">
                            <div className="flex items-center gap-2 text-primary">
                                <RefreshCw size={20} />
                                <span className="text-sm font-bold">Upload Detected</span>
                            </div>
                            <p className="text-xs text-text-secondary max-w-[200px]">
                                Generate Full Body from your uploaded reference image
                            </p>
                            {reverseReferenceUrl && (
                                <PreviewImage
                                    src={reverseReferenceUrl}
                                    alt="Reference"
                                    className="w-16 h-16 rounded-lg object-cover border border-glass-border"
                                    noLightbox
                                />
                            )}
                        </div>
                    </div>
                )}

                {/* Variant Selector / Motion Ref Content */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-gray-700">
                    {mode === 'motion' && supportsMotion ? (
                        /* Motion Ref Mode Content - Matching Static Style */
                        <div className="flex flex-col gap-4 p-4">
                            {/* Header with gradient accent */}
                            <div className="flex items-center gap-2 pb-2 border-b border-purple-500/20">
                                <div className="w-1 h-4 bg-gradient-to-b from-purple-400 to-pink-500 rounded-full"></div>
                                <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">{tc("motionRef")}</span>
                            </div>

                            {/* Video Player with glassmorphism */}
                            <div className={`relative w-full ${aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[40vh]' : aspectRatio === '1:1' ? 'aspect-square max-h-[35vh]' : 'aspect-video'} bg-gradient-to-br from-overlay to-black/60 rounded-xl overflow-hidden border border-border-subtle shadow-xl backdrop-blur-sm`}>
                                {isGeneratingMotion ? (
                                    <div className="absolute inset-0 z-10 bg-overlay backdrop-blur-md flex flex-col items-center justify-center gap-4">
                                        <div className="relative">
                                            <RefreshCw size={48} className="text-purple-400 animate-spin" />
                                            <div className="absolute inset-0 blur-xl bg-purple-500/30 animate-pulse"></div>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-sm font-bold text-foreground uppercase tracking-widest animate-pulse">Generating Video</span>
                                            <span className="text-[0.625rem] text-purple-300/60 mt-1">AI is processing motion...</span>
                                        </div>
                                    </div>
                                ) : isVideoLoading && motionRefVideos?.length > 0 ? (
                                    <div className="absolute inset-0 z-10 bg-overlay backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                                        <RefreshCw size={32} className="text-text-secondary animate-spin" />
                                        <span className="text-xs text-text-secondary font-medium">Loading Video File...</span>
                                    </div>
                                ) : null}

                                {motionRefVideos?.length > 0 ? (
                                    <PreviewVideo
                                        key={motionRefVideos[motionRefVideos.length - 1]?.url}
                                        src={motionRefVideos[motionRefVideos.length - 1]?.url}
                                        mediaId={motionRefVideos[motionRefVideos.length - 1]?.media_id}
                                        onCanPlay={() => setIsVideoLoading(false)}
                                        onLoadStart={() => setIsVideoLoading(true)}
                                        className="w-full h-full" controls autoPlay muted loop hoverPlay={false} noLightbox
                                    />
                                ) : !isGeneratingMotion && (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-text-muted gap-2">
                                        <Video size={40} className="opacity-50" />
                                        <span className="text-sm">No motion reference yet</span>
                                        <span className="text-xs opacity-70">Generate one below</span>
                                    </div>
                                )}
                            </div>

                            <div className="bg-surface rounded-lg border border-glass-border p-3">
                                <label className="text-xs font-bold text-text-muted uppercase mb-2 block">Audio Input (Optional)</label>
                                <p className="text-xs text-text-muted mb-3">Upload audio to drive lip-sync or body rhythm</p>

                                <label className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed cursor-pointer transition-all ${audioUrl
                                    ? 'border-green-500/50 bg-green-500/10 text-green-400'
                                    : 'border-indigo-500/30 hover:border-indigo-400/50 hover:bg-indigo-500/5 text-text-secondary'
                                    }`}>
                                    <input
                                        type="file"
                                        accept="audio/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) onAudioUpload?.(file);
                                        }}
                                        disabled={isUploadingAudio}
                                    />
                                    {isUploadingAudio ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary/30 border-t-primary"></div>
                                            <span className="text-xs">Uploading...</span>
                                        </>
                                    ) : audioUrl ? (
                                        <>
                                            <Check size={14} />
                                            <span className="text-xs font-medium">Audio Uploaded</span>
                                        </>
                                    ) : (
                                        <>
                                            <ImageIcon size={14} />
                                            <span className="text-xs">Upload Audio File</span>
                                        </>
                                    )}
                                </label>
                            </div>

                            {/* Motion Prompt */}
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-text-muted uppercase">Motion Prompt</label>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onResetPrompt?.();
                                        }}
                                        className="text-[0.625rem] text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                                        title="Reset to recommended prompt"
                                    >
                                        <RefreshCw size={10} />
                                        Reset
                                    </button>
                                </div>
                                <textarea
                                    value={motionPrompt}
                                    onChange={(e) => setMotionPrompt?.(e.target.value)}
                                    className="w-full h-24 bg-input-bg border border-glass-border rounded-lg p-3 text-xs text-text-secondary resize-none focus:outline-none focus:border-primary/50 font-mono leading-relaxed"
                                    placeholder="Describe the motion you want..."
                                />
                            </div>

                            {/* Generate Button */}
                            <button
                                onClick={() => onGenerateMotionRef?.(motionPrompt, audioUrl)}
                                disabled={isGeneratingMotion}
                                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${isGeneratingMotion
                                    ? 'bg-gray-700 text-text-muted cursor-not-allowed'
                                    : 'bg-primary hover:bg-primary/90 text-foreground shadow-lg'
                                    }`}
                            >
                                <Video size={16} />
                                Generate Motion Reference
                            </button>
                        </div>
                    ) : isVideo ? (
                        <VideoVariantSelector
                            videos={videos}
                            onDelete={onDeleteVideo}
                            onGenerate={onGenerateVideo}
                            isGenerating={isGenerating}
                            aspectRatio={aspectRatio}
                            className="h-full"
                        />
                    ) : (
                        <VariantSelector
                            key={assetScope}
                            asset={asset}
                            filmstripTitle={`${title} · 图片变体`}
                            currentImageUrl={currentImageUrl}
                            onSelect={onSelect}
                            onDelete={onDelete}
                            onFavorite={onFavorite}
                            onRename={onRename}
                            onGenerate={onGenerate}
                            isGenerating={isGenerating}
                            generatingBatchSize={generatingBatchSize}
                            aspectRatio={aspectRatio}
                            className="h-full"
                            previewLocator={currentProject?.id ? {
                                scope: asset?.source === "series" && currentProject.series_id ? "series" : "project",
                                containerId: asset?.source === "series" && currentProject.series_id ? currentProject.series_id : currentProject.id,
                                assetType: "character",
                                assetId: asset?.id,
                            } : undefined}
                        />
                    )}
                </div>

                {/* Status Overlay (if outdated) */}
                {status === "outdated" && !isGenerating && (
                    <div className="absolute top-4 right-4 z-10">
                        <div className="bg-yellow-500/20 border border-yellow-500/50 px-3 py-1 rounded-lg flex items-center gap-2 backdrop-blur-sm">
                            <RefreshCw size={12} className="text-yellow-500" />
                            <span className="text-xs font-bold text-yellow-500">Update Recommended</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Prompt Editor (Bottom) */}
            <div className="h-1/3 min-h-[180px] border-t border-glass-border flex flex-col bg-surface">
                <div className="p-2 border-b border-border-subtle flex justify-between items-center bg-surface">
                    <span className="text-xs font-bold text-text-muted uppercase px-2">Prompt</span>
                    <div className="flex items-center gap-1 rounded-md border border-glass-border bg-black/20 p-1" role="group" aria-label={`Image generation mode: ${title}`}>
                        {(["text", "reference"] as const).map((generationMode) => (
                            <button
                                key={generationMode}
                                type="button"
                                aria-pressed={imageGenerationMode === generationMode}
                                onClick={(event) => { event.stopPropagation(); onImageGenerationModeChange?.(generationMode); }}
                                className={`rounded px-2 py-1 text-[0.625rem] ${imageGenerationMode === generationMode ? "bg-primary/15 text-primary" : "text-text-muted hover:text-foreground"}`}
                            >
                                {generationMode === "text" ? "Text to image" : "Reference image"}
                            </button>
                        ))}
                    </div>
                </div>
                {showReferencePicker && <div className="px-4 pt-2">
                    <AssetReferencePicker
                        candidates={referenceCandidates}
                        selected={pickerReferences}
                        onChange={(references) => {
                            onPickerReferencesChange?.(references);
                            if (references.length > 0) onImageGenerationModeChange?.("reference");
                        }}
                        title="选择参考素材"
                        description="不用记住 @：搜索并选择要传给图片模型的素材变体。"
                        onOpen={onRefreshReferences}
                    />
                </div>}
                <div className="relative min-h-0 flex-1 overflow-visible p-4">
                    <ReferencePromptEditor
                        value={prompt}
                        candidates={referenceCandidates}
                        onChange={setPrompt}
                        onReferencesChange={onReferencesChange}
                        onMentionChange={(next) => {
                            if (next && !mention) onRefreshReferences?.();
                            setMention(next);
                        }}
                        allowImplicitMentions={false}
                        pruneUnlistedReferences
                        editable={!isLocked}
                        placeholder="Enter prompt description..."
                    />
                    {mention && (
                        <div
                            role="listbox"
                            aria-label="选择参考素材"
                            className="absolute bottom-full left-3 z-50 mb-2 max-h-64 w-[min(100%-1.5rem,24rem)] overflow-y-auto rounded-xl border border-glass-border bg-elevated p-2 shadow-2xl"
                        >
                            <div className="px-2 pb-1.5 pt-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">
                                参考索引
                            </div>
                            {matchingReferenceCandidates.length === 0 ? (
                                <div className="px-2 py-2 text-xs text-text-muted">
                                    {referenceCandidates.length ? "没有匹配的参考素材" : "暂无可用参考素材"}
                                </div>
                            ) : matchingReferenceCandidates.map((candidate: ReferenceCandidate) => (
                                <button
                                    key={`${candidate.reference?.asset_type}:${candidate.reference?.asset_id}:${candidate.reference?.variant_id}`}
                                    type="button"
                                    role="option"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => {
                                        mention.choose(candidate);
                                        setMention(null);
                                    }}
                                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                                >
                                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-inset">
                                        {candidate.previewRef ? (
                                            <AssetIndexPreview asset={candidate.previewRef} />
                                        ) : <ImageIcon size={15} className="text-text-muted" />}
                                    </span>
                                    <span className="min-w-0 flex-1 text-xs">
                                        <span className="block truncate text-foreground" title={candidate.label}>{candidate.label}</span>
                                        <span className="block truncate text-text-muted">{candidate.sourceLabel || "Asset"}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
