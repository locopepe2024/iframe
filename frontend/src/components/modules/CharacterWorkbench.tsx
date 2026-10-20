"use client";

import { createPortal } from "react-dom";
import { useState, useEffect, useMemo, useRef, useId, useCallback } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { X, RefreshCw, Check, Image as ImageIcon, Lock, ChevronRight, ChevronDown, Video, Sparkles, Search } from "lucide-react";
import { agentRequest, api, type AssetImageReviewRequest, type AssetLibraryReference, type AssetReferenceIndexEntry, type ChatModel, type CharacterAssetPackView } from "@/lib/api";

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
import { type VideoPolishMessages } from "./storyboard-r2v/VideoPolishReview";
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
    type PromptSlashSuggestion,
} from "./playground/ReferencePromptEditor";
import { searchReferenceCandidates } from "@/lib/referenceCandidateSearch";
import { IDENTITY_FIELDS, LOOK_FIELDS, characterSectionText, characterStructuredText, normalizeCharacterFeatures,
    characterConstraintsText, normalizeCharacterConstraints, type CharacterConstraints,
    type CharacterSectionEditorMode, type IdentityFeatures, type LookFeatures } from "@/lib/characterStructuredDesign";
import type { DictionaryConfiguration } from "@/lib/characterDictionaryPresets";
import { type CharacterPresetTarget } from "@/lib/characterQuickActions";
import CharacterDesignPanel from "./CharacterDesignPanel";
import CharacterPromptDictionary, { CharacterDictionaryHost } from "./CharacterPromptDictionary";

import type { AssetPlanEntry } from "@/lib/episodeAssetPlan";
import EpisodeAssetPlanPanel from "./EpisodeAssetPlanPanel";
import AssetNameEditor from "@/components/common/AssetNameEditor";

type CharacterImagePanel = "full_body" | "three_view" | "headshot";
type AppliedPlatformPrompt = {
    resourceId: string;
    revision: number;
    title: string;
    appliedText: string;
    customized: boolean;
};

type DesignDraft = {
    constraints?: CharacterConstraints;
    dictionary_configurations?: DictionaryConfiguration[];
    schema_version?: string;
    supplemental_prompt?: string;
    route?: string;
    style_notes?: string;
    age_stage?: string;
    identity?: Record<string, unknown> & { basis?: DesignBasis[]; features?: IdentityFeatures; editor_mode?: CharacterSectionEditorMode };
    look?: Record<string, unknown> & { basis?: DesignBasis[]; features?: LookFeatures; editor_mode?: CharacterSectionEditorMode };
    unresolved?: string[];
    field_answers?: Record<string, string>;
    field_suggestions?: Record<string, string>;
    field_suggestion_choices?: Record<string, { age_stage?: string; route?: string }>;
    user_visual_requirements?: { identity?: string; look?: string };
    reference_assets?: AssetLibraryReference[];
    field_status?: Record<string, "stated" | "inferred" | "default" | "creative-choice">;
    skill_id?: string;
    skill_revision?: string;
    preset_selections?: CharacterPresetSelection[];
    confirmed?: boolean;
};

type CharacterPresetSelection = {
    preset_id: string;
    revision: string;
    applied_target: CharacterPresetTarget | "identity_notes" | "look_notes";
    value: string;
    source: string;
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

function confirmedDesignContent(design: DesignDraft | undefined): string {
    // The question remains in the saved design draft for auditability; only
    // the user's confirmed value belongs in an image prompt.
    const answers = Object.values(design?.field_answers || {});
    if (design?.identity?.editor_mode !== "notes" && design?.look?.editor_mode !== "notes") {
        const identity = normalizeCharacterFeatures(design?.identity?.features, IDENTITY_FIELDS.map(([key]) => key));
        const look = normalizeCharacterFeatures(design?.look?.features, LOOK_FIELDS.map(([key]) => key));
        const structured = [
            characterStructuredText(identity, {}) || String(design?.identity?.visual_notes || ""),
            characterStructuredText({}, look) || String(design?.look?.visual_notes || ""),
        ].filter(Boolean).join("\n");
        if (structured) return [design?.supplemental_prompt || "", structured, ...answers, ...designScopeDescription(design?.route, design?.identity?.features?.age?.trim() ? undefined : design?.age_stage), design?.style_notes || ""].filter(Boolean).join("\n");
    }
    return designPromptDescription(
        characterSectionText(normalizeCharacterFeatures(design?.identity?.features, IDENTITY_FIELDS.map(([key]) => key)),
            IDENTITY_FIELDS.map(([key]) => key), design?.identity?.visual_notes, design?.identity?.editor_mode),
        characterSectionText(normalizeCharacterFeatures(design?.look?.features, LOOK_FIELDS.map(([key]) => key)),
            LOOK_FIELDS.map(([key]) => key), design?.look?.visual_notes, design?.look?.editor_mode),
        [...answers, ...designScopeDescription(design?.route, design?.identity?.features?.age?.trim() ? undefined : design?.age_stage), design?.style_notes || ""],
    );
}

function confirmedDesignDescription(design: DesignDraft | undefined): string {
    return [confirmedDesignContent(design), characterConstraintsText(normalizeCharacterConstraints(design?.constraints))].filter(Boolean).join("\n");
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
    const savedDesign = (asset.character_design?.design_draft || asset.character_design?.design_revisions?.at(-1)?.design || {}) as DesignDraft;
    const [designRoute, setDesignRoute] = useState(savedDesign.route || "");
    const [styleNotes, setStyleNotes] = useState(savedDesign.style_notes || "");
    const [designAgeStage, setDesignAgeStage] = useState(savedDesign.age_stage || "");
    const [dictionaryConfigurations, setDictionaryConfigurations] = useState<DictionaryConfiguration[]>(savedDesign.dictionary_configurations || []);
    const [supplementalPrompt, setSupplementalPrompt] = useState(savedDesign.supplemental_prompt || "");
    const [designConstraints, setDesignConstraints] = useState<CharacterConstraints>(() => normalizeCharacterConstraints(savedDesign.constraints));
    const [designNotes, setDesignNotes] = useState(String(savedDesign.identity?.visual_notes || ""));
    const [lookNotes, setLookNotes] = useState(String(savedDesign.look?.visual_notes || ""));
    const [identityFeatures, setIdentityFeatures] = useState<IdentityFeatures>(
        normalizeCharacterFeatures(savedDesign.identity?.features, IDENTITY_FIELDS.map(([key]) => key)));
    const [lookFeatures, setLookFeatures] = useState<LookFeatures>(
        normalizeCharacterFeatures(savedDesign.look?.features, LOOK_FIELDS.map(([key]) => key)));
    const [identityEditorMode, setIdentityEditorMode] = useState<CharacterSectionEditorMode>(
        savedDesign.identity?.editor_mode || (Object.values(savedDesign.identity?.features || {}).some((value) => typeof value === "string" && value.trim()) ? "fields" : "notes"));
    const [lookEditorMode, setLookEditorMode] = useState<CharacterSectionEditorMode>(
        savedDesign.look?.editor_mode || (Object.values(savedDesign.look?.features || {}).some((value) => typeof value === "string" && value.trim()) ? "fields" : "notes"));
    const [presetSelections, setPresetSelections] = useState<CharacterPresetSelection[]>(savedDesign.preset_selections || []);
    const [designIdentityBasis, setDesignIdentityBasis] = useState<DesignBasis[]>(normalizeDesignBasis(savedDesign.identity?.basis));
    const [designLookBasis, setDesignLookBasis] = useState<DesignBasis[]>(normalizeDesignBasis(savedDesign.look?.basis));
    const [designSource, setDesignSource] = useState<"stated" | "creative-choice">(savedDesign.field_status?.visual_notes === "creative-choice" ? "creative-choice" : "stated");
    const [designUnresolved, setDesignUnresolved] = useState<string[]>(
        actionableDesignQuestions(savedDesign.unresolved, savedDesign.field_answers, savedDesign.field_suggestions),
    );
    const [designFieldAnswers, setDesignFieldAnswers] = useState<Record<string, string>>(savedDesign.field_answers || {});
    const [designFieldSuggestions, setDesignFieldSuggestions] = useState<Record<string, string>>(savedDesign.field_suggestions || {});
    const [designFieldSuggestionChoices, setDesignFieldSuggestionChoices] = useState<Record<string, { age_stage?: string; route?: string }>>(savedDesign.field_suggestion_choices || {});
    const [designSkillRevision, setDesignSkillRevision] = useState(savedDesign.skill_revision || "");
    const [designModels, setDesignModels] = useState<ChatModel[]>([]);
    const [designModel, setDesignModel] = useState("");
    const [designing, setDesigning] = useState(false);
    const [designStatus, setDesignStatus] = useState(savedDesign.confirmed ? "confirmed" : "draft");
    const [designRevision, setDesignRevision] = useState<number>(asset.character_design?.design_revisions?.at(-1)?.revision || 0);
    const [savingDesign, setSavingDesign] = useState(false);
    const [designError, setDesignError] = useState("");
    const [designInput, setDesignInput] = useState([savedDesign.user_visual_requirements?.identity, savedDesign.user_visual_requirements?.look].filter(Boolean).join("\n") || confirmedDesignContent(savedDesign) || asset.full_body_prompt || "");
    const [designResult, setDesignResult] = useState<string | null>(
        confirmedDesignContent(savedDesign) || null);
    const updateProject = useProjectStore(state => state.updateProject);
    const currentProject = useProjectStore(state => state.currentProject);
    const [assetPackView, setAssetPackView] = useState<CharacterAssetPackView | null>(null);
    const [anchorBusy, setAnchorBusy] = useState(false);
    const [anchorError, setAnchorError] = useState("");
    const [episodeLookLabel, setEpisodeLookLabel] = useState("");
    const [episodeLookCondition, setEpisodeLookCondition] = useState("");
    const [episodeLookBusy, setEpisodeLookBusy] = useState(false);
    const [episodeLookError, setEpisodeLookError] = useState("");
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
    const [platformPromptSources, setPlatformPromptSources] = useState<Record<CharacterImagePanel, AppliedPlatformPrompt | null>>({
        full_body: null, three_view: null, headshot: null,
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
        setPlatformPromptSources({ full_body: null, three_view: null, headshot: null });
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
    const characterPreviewLocator = currentProject?.id ? {
        scope: asset.source === "series" && currentProject.series_id ? "series" : "project",
        containerId: asset.source === "series" && currentProject.series_id ? currentProject.series_id : currentProject.id,
        assetType: "character",
        assetId: asset.id,
    } : undefined;
    const masterAsset = referenceSheetImageAsset || asset.full_body_asset;
    const masterGenerationType = referenceSheetImageAsset ? "reference_sheet" : "full_body";
    const hasFullBodyImage = !!masterImageUrl;
    const selectedMasterVariantId = masterAsset?.selected_id as string | undefined;

    useEffect(() => {
        let active = true;
        setAssetPackView(null);
        setAnchorError("");
        const projectCharacterId = asset.base_character_id || asset.id;
        if (currentProject?.id && projectCharacterId) {
            void api.getCharacterAssetPack(currentProject.id, projectCharacterId)
                .then((view) => { if (active) setAssetPackView(view); })
                .catch(() => { if (active) setAssetPackView(null); });
        }
        return () => { active = false; };
    }, [currentProject?.id, asset.id, asset.base_character_id]);

    useEffect(() => {
        const projectId = currentProject?.id;
        if (!projectId || typeof api.listEpisodeCharacterUses !== "function") return;
        let active = true;
        void api.listEpisodeCharacterUses(projectId)
            .then((uses) => {
                if (active) updateProject(projectId, { episode_character_uses: uses });
            })
            .catch(() => { /* retain the current snapshot if refresh is unavailable */ });
        return () => { active = false; };
    }, [currentProject?.id, updateProject]);

    const confirmMasterAnchor = async () => {
        if (!currentProject?.id || !selectedMasterVariantId || anchorBusy) return;
        if (!window.confirm(`确认当前选中的图片 ${selectedMasterVariantId} 是该角色正面全身锚点图？请核对面容、发型、服装与鞋履。`)) return;
        setAnchorBusy(true);
        setAnchorError("");
        try {
            await selectionQueue.current;
            const current = await api.getCharacterAssetPack(currentProject.id, asset.id);
            const updated = await api.confirmCharacterAnchor(
                currentProject.id, asset.id, selectedMasterVariantId,
                current.asset_revision, current.pack?.current_revision || 0,
            );
            setAssetPackView(updated);
        } catch (error) {
            setAnchorError(error instanceof Error ? error.message : "锚点确认失败，请刷新后重试");
        } finally {
            setAnchorBusy(false);
        }
    };

    const confirmEpisodeLook = async () => {
        if (!currentProject?.id || !assetPackView?.pack || !selectedMasterVariantId || episodeLookBusy) return;
        const projectCharacterId = asset.base_character_id || asset.id;
        const label = episodeLookLabel.trim() || asset.name;
        if (!window.confirm(`确认本集造型“${label}”使用当前图片 ${selectedMasterVariantId}？\n来源：${projectCharacterId} / 资产包 r${assetPackView.pack.current_revision}\n状态：${episodeLookCondition.trim() || "无额外状态"}`)) return;
        setEpisodeLookBusy(true);
        setEpisodeLookError("");
        try {
            await selectionQueue.current;
            const latest = await api.getCharacterAssetPack(currentProject.id, projectCharacterId);
            if (!latest.pack) throw new Error("请先确认项目角色正面全身锚点");
            const use = await api.confirmEpisodeCharacterUse(currentProject.id, projectCharacterId, {
                label, condition: episodeLookCondition.trim(), selected_asset_id: asset.id,
                selected_variant_id: selectedMasterVariantId,
                expected_pack_revision: latest.pack.current_revision, reviewed: true,
            });
            updateProject(currentProject.id, {
                episode_character_uses: [...(currentProject.episode_character_uses || []), use],
            });
            setEpisodeLookLabel("");
            setEpisodeLookCondition("");
            toast.success(`已确认本集造型：${use.label}`);
        } catch (error: any) {
            setEpisodeLookError(String(error?.response?.data?.detail || error?.message || "本集造型确认失败"));
        } finally {
            setEpisodeLookBusy(false);
        }
    };

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
    const [negativePrompt, setNegativePrompt] = useState(() => [DEFAULT_CHARACTER_NEGATIVE_PROMPT,
        ...normalizeCharacterConstraints((asset.character_design?.design_revisions?.at(-1)?.design as DesignDraft | undefined)?.constraints).negative_prompt,
    ].filter(Boolean).join("\n"));
    const appliedDesignNegative = useRef(normalizeCharacterConstraints(
        (asset.character_design?.design_revisions?.at(-1)?.design as DesignDraft | undefined)?.constraints).negative_prompt);

    const projectedIdentity = characterSectionText(identityFeatures, IDENTITY_FIELDS.map(([key]) => key), designNotes, identityEditorMode);
    const projectedLook = characterSectionText(lookFeatures, LOOK_FIELDS.map(([key]) => key), lookNotes, lookEditorMode);
    const normalizedConstraints = normalizeCharacterConstraints(designConstraints);
    const designConstraintText = characterConstraintsText(normalizedConstraints);
    const currentDesignDescription = [designResult ?? (designInput || designPromptDescription(
        projectedIdentity,
        projectedLook,
        [...Object.values(designFieldAnswers), ...designScopeDescription(designRoute, identityFeatures.age?.trim() ? undefined : designAgeStage), styleNotes],
    )), designConstraintText].filter(Boolean).join("\n");

    const [designTab, setDesignTab] = useState<"design" | "ai">("design");
    const savedDesignText = useRef(designResult ?? designInput);
    const savedDesignSnapshot = useRef<DesignDraft>(savedDesign);
    const [hasSavedDesign, setHasSavedDesign] = useState(!!asset.character_design);

    const applyDesignToPrompts = () => {
        const previousNegative = appliedDesignNegative.current;
        setNegativePrompt(current => Array.from(new Set([
            ...current.split('\n').filter(line => line && !previousNegative.includes(line)), ...normalizedConstraints.negative_prompt,
        ])).join('\n'));
        appliedDesignNegative.current = normalizedConstraints.negative_prompt;
        setFullBodyPrompt(buildCharacterImagePrompt("full_body", asset.name, currentDesignDescription, hasNonFullBodyUpload));
        setThreeViewPrompt(buildCharacterImagePrompt("three_view", asset.name, currentDesignDescription, hasFullBodyImage || hasAnyUpload));
        setHeadshotPrompt(buildCharacterImagePrompt("headshot", asset.name, currentDesignDescription, hasFullBodyImage || hasAnyUpload));
        setPromptsNeedDesignApply(false);
    };
    const characterDesignRequest = {
        model: designModel,
        project_id: currentProject?.id,
        reference_assets: [],
        character_name: asset.name,
        profile: asset.description,
        current_draft: designInput,
        dictionary_configurations: dictionaryConfigurations,
        structured_identity: identityEditorMode === "fields" ? identityFeatures : {},
        structured_look: lookEditorMode === "fields" ? lookFeatures : {},
        constraints: normalizedConstraints,
        route: "",

    };
    const characterDesignSource = JSON.stringify({ ...characterDesignRequest, asset_id: asset.id, result: designResult, supplemental: supplementalPrompt });
    const characterDesignSourceRef = useRef(characterDesignSource);
    characterDesignSourceRef.current = characterDesignSource;

    const generateDesignDraft = async () => {
        if (!designModel || designing || !asset.description.trim() || designInput.length > 8000) return;
        setDesigning(true);
        setDesignError("");
        const source = characterDesignSource;
        const request = characterDesignRequest;
        try {
            const preview = await agentRequest<{ messages: VideoPolishMessages; review_token: string }>(
                "/character-design/draft/preview", "POST", request);
            if (characterDesignSourceRef.current !== source) return;
            const result = await agentRequest<{
                identity: { visual_notes: string; features?: IdentityFeatures; basis?: string | string[] };
                look: { visual_notes: string; features?: LookFeatures; basis?: string | string[] };
                unresolved: string[];
                field_suggestions?: Record<string, string>;
                field_suggestion_choices?: Record<string, { age_stage?: string; route?: string }>;
                skill_revision: string;
            }>("/character-design/draft", "POST", {
                ...request, reviewed_messages: preview.messages, review_token: preview.review_token,
            });
            if (source !== characterDesignSourceRef.current) return;
            const nextIdentity = result.identity.visual_notes;
            const nextLook = result.look.visual_notes;
            const nextIdentityFeatures = normalizeCharacterFeatures(result.identity.features, IDENTITY_FIELDS.map(([key]) => key));
            const nextLookFeatures = normalizeCharacterFeatures(result.look.features, LOOK_FIELDS.map(([key]) => key));
            const identityText = characterSectionText(nextIdentityFeatures, IDENTITY_FIELDS.map(([key]) => key), nextIdentity);
            const lookText = characterSectionText(nextLookFeatures, LOOK_FIELDS.map(([key]) => key), nextLook);
            setDesignResult([
                characterStructuredText(nextIdentityFeatures, {}) || (identityText && `身份：${identityText}`),
                characterStructuredText({}, nextLookFeatures) || (lookText && `造型：${lookText}`),
            ].filter(Boolean).join("\n"));
            setSupplementalPrompt("");
            setDesignNotes(nextIdentity);
            setLookNotes(nextLook);
            setIdentityFeatures(nextIdentityFeatures);
            setLookFeatures(nextLookFeatures);
            setIdentityEditorMode(Object.values(nextIdentityFeatures).some((value) => value?.trim()) ? "fields" : "notes");
            setLookEditorMode(Object.values(nextLookFeatures).some((value) => value?.trim()) ? "fields" : "notes");
            setPresetSelections([]);
            setDesignRoute(""); setDesignAgeStage(""); setStyleNotes("");
            setDesignIdentityBasis(normalizeDesignBasis(result.identity.basis));
            setDesignLookBasis(normalizeDesignBasis(result.look.basis));
            const questions = actionableDesignQuestions(result.unresolved, {}, result.field_suggestions);
            setDesignFieldSuggestions(Object.fromEntries(
                Object.entries(result.field_suggestions || {}).filter(([question, suggestion]) => questions.includes(question) && !!suggestion.trim()),
            ));
            setDesignFieldSuggestionChoices(Object.fromEntries(
                Object.entries(result.field_suggestion_choices || {}).filter(([question]) => questions.includes(question)),
            ));
            setDesignUnresolved(questions);
            setDesignFieldAnswers({});
            setDesignSource(
                [...normalizeDesignBasis(result.identity.basis), ...normalizeDesignBasis(result.look.basis)].includes("creative_choice")
                    ? "creative-choice"
                    : "stated",
            );
            setDesignSkillRevision(result.skill_revision);
            setDesignStatus("draft");
            setDesignTab("ai");
            setPromptsNeedDesignApply(true);
        } catch (error) {
            if (source === characterDesignSourceRef.current) setDesignError(error instanceof Error ? error.message : "完善角色设计失败，请重试。");
        } finally {
            setDesigning(false);
        }
    };

    const saveDesign = async () => {
        if (!onUpdateAttributes || savingDesign) return;
        if ([normalizedConstraints.must_keep, normalizedConstraints.negative_prompt].some(items => items.length > 20 || items.some(item => item.length > 500))) {
            setDesignError("每类设计约束最多 20 项，每项最多 500 字。");
            return;
        }
        if (!(designResult ?? designInput).trim()) {
            setDesignError("请先填写具体的角色视觉值，再保存设计。 ");
            return;
        }
        const unanswered = designUnresolved.filter((question) => !designFieldAnswers[question]?.trim());
        const manualInput = designResult === null ? designInput : null;
        const draft: DesignDraft = {
            constraints: normalizedConstraints,
            dictionary_configurations: dictionaryConfigurations,
            schema_version: "iframe.character-fields.v1",
            supplemental_prompt: manualInput !== null ? "" : supplementalPrompt,
            route: manualInput !== null ? "" : designRoute,
            style_notes: manualInput !== null ? undefined : styleNotes || undefined,
            age_stage: manualInput !== null ? undefined : designAgeStage || undefined,
            identity: manualInput !== null
                ? { visual_notes: manualInput, features: {}, editor_mode: "notes", basis: ["user_specified"] }
                : { visual_notes: designNotes || undefined, features: identityFeatures, editor_mode: identityEditorMode, basis: designIdentityBasis },
            look: manualInput !== null ? { features: {}, editor_mode: "notes" }
                : { route: designRoute, visual_notes: lookNotes || undefined, features: lookFeatures, editor_mode: lookEditorMode, basis: designLookBasis },
            unresolved: manualInput !== null ? [] : designNotes ? unanswered : [],
            field_answers: manualInput !== null ? {} : Object.fromEntries(Object.entries(designFieldAnswers).filter(([, answer]) => answer.trim())),
            user_visual_requirements: { identity: designInput, look: "" },
            field_suggestions: manualInput !== null ? {} : Object.fromEntries(Object.entries(designFieldSuggestions).filter(([question]) => !designFieldAnswers[question]?.trim())),
            field_suggestion_choices: manualInput !== null ? {} : Object.fromEntries(Object.entries(designFieldSuggestionChoices).filter(([question]) => !designFieldAnswers[question]?.trim())),
            reference_assets: savedDesign.reference_assets || [],
            field_status: { route: "stated", age_stage: designAgeStage ? "stated" : "default", visual_notes: designNotes ? designSource : "default" },
            skill_id: "character-style-routes",
            skill_revision: designSkillRevision || undefined,
            preset_selections: presetSelections,
            confirmed: true,
        };
        setSavingDesign(true);
        setDesignError("");
        try {
            await onUpdateAttributes({ character_design: draft });
            if (manualInput !== null) {
                setDesignResult(manualInput);
                setDesignNotes(manualInput); setLookNotes("");
                setIdentityFeatures({}); setLookFeatures({});
                setIdentityEditorMode("notes"); setLookEditorMode("notes");
                setDesignRoute(""); setDesignAgeStage(""); setStyleNotes("");
            }
            setDesignUnresolved(draft.unresolved || []);
            savedDesignText.current = designResult ?? designInput;
            savedDesignSnapshot.current = draft;
            setHasSavedDesign(true);
            setDesignStatus("confirmed");
            setDesignRevision((revision) => revision + 1);
            applyDesignToPrompts();
        } catch (error) {
            setDesignError(error instanceof Error ? error.message : "保存视觉设计失败，请重试。");
        } finally {
            setSavingDesign(false);
        }
    };
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
        if (!currentProject?.id) return;
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


    const setPanelMode = (type: "full_body" | "three_view" | "headshot", mode: "text" | "reference") => {
        setPromptModes((current) => ({ ...current, [type]: mode }));
    };

    const [reviewEditorHost, setReviewEditorHost] = useState<HTMLDivElement | null>(null);
    const imageReviewRequest = useMemo(() => {
        if (!pendingImageReview) return null;
        const type = pendingImageReview.generation_type === "reference_sheet" ? "full_body" : pendingImageReview.generation_type;
        if (type !== "full_body" && type !== "three_view" && type !== "headshot") return pendingImageReview;
        const prompt = type === "full_body" ? fullBodyPrompt : type === "three_view" ? threeViewPrompt : headshotPrompt;
        const references = [...promptReferences[type], ...promptPickerReferences[type]]
            .filter((reference, index, all) => all.findIndex(candidate => referenceKey(candidate) === referenceKey(reference)) === index);
        const isDerived = type === "three_view" || type === "headshot";
        return {
            ...pendingImageReview, prompt, negative_prompt: negativePrompt, image_generation_mode: promptModes[type],
            reference: isDerived ? references[0] : undefined,
            references: isDerived ? [] : references,
        };
    }, [fullBodyPrompt, threeViewPrompt, headshotPrompt, negativePrompt, promptReferences, promptPickerReferences,
        promptModes, pendingImageReview]);
    const reviewReferences = imageReviewRequest?.reference ? [imageReviewRequest.reference] : imageReviewRequest?.references || [];
    const reviewValidationError = !imageReviewRequest ? "" :
        imageReviewRequest.image_generation_mode === "text" && reviewReferences.length > 0
            ? "已选择参考素材，请切换到参考生图或移除素材。" :
        imageReviewRequest.image_generation_mode === "reference" && reviewReferences.length === 0
            ? "请选择至少一张参考素材。" :
        (imageReviewRequest.generation_type === "three_view" || imageReviewRequest.generation_type === "headshot") &&
            (imageReviewRequest.image_generation_mode !== "reference" || reviewReferences.length !== 1)
            ? "三视图和头像需要选择一张角色主图作为参考。" : "";

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

    const recordDictionaryConfiguration = (configuration: DictionaryConfiguration) => {
        setDictionaryConfigurations(current => [...current.filter(item => item.preset_id !== configuration.preset_id), configuration]);
    };

    const updateStructuredDesign = (identityPatch: IdentityFeatures, lookPatch: LookFeatures, details?: string, remainingText?: string) => {
        const nextIdentity = { ...(identityEditorMode === "fields" ? identityFeatures : {}), ...identityPatch };
        const nextLook = { ...(lookEditorMode === "fields" ? lookFeatures : {}), ...lookPatch };
        setIdentityFeatures(nextIdentity); setLookFeatures(nextLook);
        setIdentityEditorMode("fields"); setLookEditorMode("fields");
        const legacyNotes = [identityEditorMode === "notes" ? designNotes : "", lookEditorMode === "notes" ? lookNotes : ""].filter(Boolean).join("\n");
        const supplemental = remainingText !== undefined ? remainingText.trim() : supplementalPrompt || legacyNotes ||
            (!designResult && !Object.keys(identityFeatures).length && !Object.keys(lookFeatures).length ? designInput : "");
        setSupplementalPrompt(supplemental);
        setDesignResult([supplemental, characterStructuredText(nextIdentity, nextLook)].filter(Boolean).join("\n"));
        if (details !== undefined) setDesignInput(details);
        setDesignIdentityBasis(["user_specified"]); setDesignLookBasis(["user_specified"]);
        setDesignStatus("draft"); setPromptsNeedDesignApply(true);
    };

    const designEditor = <CharacterDesignPanel
        description={asset.description} details={designInput}
        onDictionaryConfiguration={recordDictionaryConfiguration}
        identityFields={identityFeatures} lookFields={lookFeatures}
        onFieldsChange={(section, key, value) => updateStructuredDesign(section === "identity" ? { [key]: value } : {}, section === "look" ? { [key]: value } : {})}
        onDictionaryFields={(text, fields, remaining) => {
            updateStructuredDesign(fields.identity, fields.look, text, remaining);
            if (fields.constraints) setDesignConstraints(current => normalizeCharacterConstraints({
                must_keep: [...current.must_keep, ...fields.constraints!.must_keep],
                negative_prompt: [...current.negative_prompt, ...fields.constraints!.negative_prompt],
            }));
        }}
        constraints={designConstraints} onConstraintsChange={value => {
            setDesignConstraints(value); setDesignStatus("draft"); setPromptsNeedDesignApply(true);
        }}
        supplemental={supplementalPrompt} onSupplementalChange={value => {
            setSupplementalPrompt(value);
            setDesignResult([value, characterStructuredText(identityFeatures, lookFeatures)].filter(Boolean).join("\n"));
            setDesignStatus("draft"); setPromptsNeedDesignApply(true);
        }}
        onDetailsChange={value => {
            setDesignConstraints({ must_keep: [], negative_prompt: [] });
            setDesignInput(value); setDesignResult(null); setDesignStatus("draft"); setPromptsNeedDesignApply(true);
            setIdentityFeatures({}); setLookFeatures({}); setDesignNotes(""); setLookNotes("");
            setIdentityEditorMode("notes"); setLookEditorMode("notes"); setSupplementalPrompt("");
        }}
        reviewItems={designUnresolved.map(question => [question, designFieldSuggestions[question]].filter(Boolean).join("："))}
        result={designResult !== null || designConstraintText ? currentDesignDescription : null} onResultChange={value => {
            setDesignConstraints({ must_keep: [], negative_prompt: [] });
            setDesignResult(value);
            setSupplementalPrompt("");
            const sections = value.match(/^身份：[\s\S]*?\n造型：/);
            if (sections) {
                const boundary = value.indexOf("\n造型：");
                setDesignNotes(value.slice(3, boundary));
                setLookNotes(value.slice(boundary + 4));
            } else { setDesignNotes(value); setLookNotes(""); }
            setIdentityFeatures({}); setLookFeatures({});
            setIdentityEditorMode("notes"); setLookEditorMode("notes");
            setDesignRoute(""); setDesignAgeStage(""); setStyleNotes("");
            setDesignIdentityBasis(["user_specified"]); setDesignLookBasis(["user_specified"]);
            setDesignSource("stated"); setDesignStatus("draft"); setPromptsNeedDesignApply(true);
        }}
        models={designModels} model={designModel} onModelChange={setDesignModel}
        busy={designing} saving={savingDesign} canSave={!!onUpdateAttributes} canReedit={hasSavedDesign} error={designError}
        status={designStatus === "confirmed" ? "已保存 · 当前设计已生效" : hasSavedDesign ? "已保存的设计有修改 · 保存后生效" : "尚未保存"}
        tab={designTab} onTabChange={setDesignTab}
        onSubmit={() => void generateDesignDraft()} onSave={() => void saveDesign()}
        onReedit={() => {
            const snapshot = savedDesignSnapshot.current;
            setDesignInput(savedDesignText.current); setDesignResult(savedDesignText.current);
            setIdentityFeatures(normalizeCharacterFeatures(snapshot.identity?.features, IDENTITY_FIELDS.map(([key]) => key)));
            setLookFeatures(normalizeCharacterFeatures(snapshot.look?.features, LOOK_FIELDS.map(([key]) => key)));
            setDesignNotes(String(snapshot.identity?.visual_notes || "")); setLookNotes(String(snapshot.look?.visual_notes || ""));
            setIdentityEditorMode(snapshot.identity?.editor_mode || "notes"); setLookEditorMode(snapshot.look?.editor_mode || "notes");
            setSupplementalPrompt(snapshot.supplemental_prompt || "");
            setDesignRoute(snapshot.route || ""); setDesignAgeStage(snapshot.age_stage || ""); setStyleNotes(snapshot.style_notes || "");
            setDesignConstraints(normalizeCharacterConstraints(snapshot.constraints));
            setDictionaryConfigurations(snapshot.dictionary_configurations || []);
            setDesignIdentityBasis(normalizeDesignBasis(snapshot.identity?.basis));
            setDesignLookBasis(normalizeDesignBasis(snapshot.look?.basis));
            setDesignFieldSuggestions(snapshot.field_suggestions || {});
            setDesignFieldSuggestionChoices(snapshot.field_suggestion_choices || {});
            setDesignSkillRevision(snapshot.skill_revision || ""); setPresetSelections(snapshot.preset_selections || []);
            setDesignSource(snapshot.field_status?.visual_notes === "creative-choice" ? "creative-choice" : "stated");
            setDesignUnresolved(snapshot.unresolved || []); setDesignFieldAnswers(snapshot.field_answers || {});
            setDesignTab("design"); setDesignStatus("draft");
            setPromptsNeedDesignApply(false);
        }}
    />;

    const imageSettings = <div className="space-y-3 px-4 pb-4">
        <label className="block text-xs text-text-secondary" htmlFor="character-image-negative">出图负面提示词</label>
        <textarea id="character-image-negative" value={negativePrompt} onChange={event => setNegativePrompt(event.target.value)} rows={3}
            placeholder="Enter your negative prompt (avoid unwanted elements)..."
            className="w-full rounded border border-glass-border bg-surface p-2 text-sm text-foreground" />
        {(stylePrompt || styleNegativePrompt) && <button type="button" onClick={() => {
            if (activePanel === "full_body") setFullBodyPrompt(current => includeVisibleStyle(current, stylePrompt));
            if (activePanel === "three_view") setThreeViewPrompt(current => includeVisibleStyle(current, stylePrompt));
            if (activePanel === "headshot") setHeadshotPrompt(current => includeVisibleStyle(current, stylePrompt));
            setNegativePrompt(current => includeVisibleStyle(current, styleNegativePrompt));
        }} className="min-h-11 rounded border border-glass-border px-3 text-xs text-text-secondary">{tc("copyStyleToPrompt")}</button>}
    </div>;

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-md">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface border border-glass-border w-full h-full flex flex-col overflow-hidden shadow-lg"
            >
                <div className="relative z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-glass-border bg-surface px-4 md:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        <div role="heading" aria-level={2} className="min-w-0 text-lg font-bold text-foreground md:text-xl"><AssetNameEditor key={asset.id} name={asset.name} onRename={onRename} className="font-bold" /></div>
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

                <div className="min-h-0 flex-1 flex flex-col lg:flex-row overflow-hidden">

                    <div className="min-h-0 min-w-0 flex-1 flex flex-col">
                        {promptsNeedDesignApply && <div className="mx-3 mt-3 flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 sm:mx-5 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground">角色设计草稿尚未应用到图片提示词</p>
                                <p className="mt-0.5 text-[11px] leading-4 text-text-muted">应用会更新全身、三视图和肖像提示词，不保存角色设计或创建版本；之后仍可编辑提示词。</p>
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
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 border-b border-glass-border px-3 sm:px-5" data-testid="character-asset-toolbar">
                            <div role="tablist" aria-label={tc("materialTypes")} className="flex min-w-0 gap-1 overflow-x-auto">
                                {([ ["full_body", tc("masterAsset")], ["three_view", tc("threeViews")], ["headshot", tc("avatar")] ] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={activePanel === id} tabIndex={activePanel === id ? 0 : -1} onClick={() => setActivePanel(id)} onKeyDown={(event) => {
                                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                    event.preventDefault();
                                    const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') || []);
                                    const next = tabs[(tabs.indexOf(event.currentTarget) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                                    next?.click();
                                    next?.focus();
                                }} className={`min-h-11 shrink-0 border-b-2 px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activePanel === id ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-foreground"}`}>{label}</button>)}
                            </div>
                            {activePanel !== "three_view" && <CharacterPresentationSwitch
                                mode={activePanel === "full_body" ? fullBodyMode : headshotMode}
                                onModeChange={activePanel === "full_body" ? setFullBodyMode : setHeadshotMode}
                                hasStaticImage={activePanel === "full_body" ? hasFullBodyImage : !!asset.headshot_image_url || !!asset.headshot_asset?.variants?.length}
                            />}
                        </div>
                        {activePanel === "full_body" && <div className="flex flex-wrap items-center gap-2 border-b border-glass-border px-3 py-2 text-xs text-text-secondary sm:px-5">
                            <span>{asset.base_character_id ? "来源项目角色锚点" : "项目角色锚点"}：{assetPackView?.pack ? `r${assetPackView.pack.current_revision} · ${assetPackView.pack.revisions.at(-1)?.variant_id}` : "未确认"}</span>
                            {!asset.base_character_id && <button type="button" onClick={() => void confirmMasterAnchor()}
                                disabled={!selectedMasterVariantId || !designRevision || !assetPackView || anchorBusy}
                                className="rounded border border-glass-border px-2 py-1 text-foreground hover:bg-hover-bg disabled:opacity-50">
                                {anchorBusy ? "确认中…" : "将选中图确认为正面全身锚点"}
                            </button>}
                            {anchorError && <span role="alert" className="text-red-400">{anchorError}</span>}
                        </div>}
                        {activePanel === "full_body" && assetPackView?.pack && <div className="border-b border-glass-border px-3 py-2 text-xs text-text-secondary sm:px-5">
                            <div className="mb-2 font-medium text-foreground">本集造型 · 人工确认后可在分镜中选择</div>
                            <div className="flex flex-wrap items-center gap-2">
                                <input aria-label="本集造型名称" value={episodeLookLabel} onChange={(event) => setEpisodeLookLabel(event.target.value)}
                                    placeholder={asset.base_character_id ? "例如：受伤造型" : "例如：正常造型"} maxLength={120}
                                    className="min-w-36 rounded border border-glass-border bg-surface-inset px-2 py-1 text-foreground" />
                                <input aria-label="本集造型状态" value={episodeLookCondition} onChange={(event) => setEpisodeLookCondition(event.target.value)}
                                    placeholder="状态说明，可留空" maxLength={500}
                                    className="min-w-40 flex-1 rounded border border-glass-border bg-surface-inset px-2 py-1 text-foreground" />
                                <button type="button" onClick={() => void confirmEpisodeLook()}
                                    disabled={!selectedMasterVariantId || episodeLookBusy || (!asset.base_character_id && selectedMasterVariantId !== assetPackView.pack.revisions.at(-1)?.variant_id)}
                                    className="rounded border border-primary/50 px-2 py-1 text-primary hover:bg-primary/10 disabled:opacity-50">
                                    {episodeLookBusy ? "确认中…" : "确认选中图为本集造型"}
                                </button>
                            </div>
                            {episodeLookError && <p role="alert" className="mt-1 text-red-400">{episodeLookError}</p>}
                            {(currentProject?.episode_character_uses || []).filter((item) => item.project_character_id === (asset.base_character_id || asset.id)).length > 0 &&
                                <p className="mt-2">本集已确认：{(currentProject?.episode_character_uses || [])
                                    .filter((item) => item.project_character_id === (asset.base_character_id || asset.id))
                                    .map((item) => `${item.label} · ${item.selected_asset_id}/${item.selected_variant_id}`).join("；")}</p>}
                        </div>}
                        <div className="min-h-0 flex-1 flex overflow-hidden">

                    {/* Panel 1: Full Body (Master) */}
                    {activePanel === "full_body" &&
                    <WorkbenchPanel
                        assetScope={asset.id}
                        previewLocator={characterPreviewLocator}
                        hideTitle
                        designEditor={designEditor}
                        imageSettings={imageSettings}
                        reviewEditorHost={reviewEditorHost}
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
                        onDictionaryConfiguration={recordDictionaryConfiguration}
                        onStructuredSelection={(text: string, fields: { identity: IdentityFeatures; look: LookFeatures }, remaining: string) => {
                            updateStructuredDesign(fields.identity, fields.look, text, remaining);
                        }}
                        platformPromptSource={platformPromptSources.full_body}
                        onPlatformPromptSourceChange={(source: AppliedPlatformPrompt | null) => setPlatformPromptSources((current) => ({ ...current, full_body: source }))}
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
                        previewLocator={characterPreviewLocator}
                        hideTitle
                        designEditor={designEditor}
                        imageSettings={imageSettings}
                        reviewEditorHost={reviewEditorHost}
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
                        onDictionaryConfiguration={recordDictionaryConfiguration}
                        onStructuredSelection={(text: string, fields: { identity: IdentityFeatures; look: LookFeatures }, remaining: string) => {
                            updateStructuredDesign(fields.identity, fields.look, text, remaining);
                        }}
                        platformPromptSource={platformPromptSources.three_view}
                        onPlatformPromptSourceChange={(source: AppliedPlatformPrompt | null) => setPlatformPromptSources((current) => ({ ...current, three_view: source }))}
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
                        previewLocator={characterPreviewLocator}
                        hideTitle
                        designEditor={designEditor}
                        imageSettings={imageSettings}
                        reviewEditorHost={reviewEditorHost}
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
                        onDictionaryConfiguration={recordDictionaryConfiguration}
                        onStructuredSelection={(text: string, fields: { identity: IdentityFeatures; look: LookFeatures }, remaining: string) => {
                            updateStructuredDesign(fields.identity, fields.look, text, remaining);
                        }}
                        platformPromptSource={platformPromptSources.headshot}
                        onPlatformPromptSourceChange={(source: AppliedPlatformPrompt | null) => setPlatformPromptSources((current) => ({ ...current, headshot: source }))}
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


            </motion.div>
            {imageReviewRequest && currentProject?.id && <AssetImageSubmissionReview
                projectId={currentProject.id}
                request={imageReviewRequest}
                validationError={reviewValidationError}
                editor={<div ref={setReviewEditorHost} className="relative mt-3" />}
                onBack={() => setPendingImageReview(null)}
                onConfirm={(review) => {
                    const request = imageReviewRequest;
                    setPendingImageReview(null);
                    onGenerate(request.generation_type, request.prompt, false, request.negative_prompt,
                        request.batch_size, request.reference ? [request.reference] : request.references || [],
                        request.image_generation_mode, review.fingerprint);
                }}
            />}
        </div>
    );
}

function CharacterPresentationSwitch({ mode, onModeChange, hasStaticImage }: {
    mode: "static" | "motion";
    onModeChange?: (mode: "static" | "motion") => void;
    hasStaticImage: boolean;
}) {
    const tc = useTranslations("character");
    return (
        <div role="group" aria-label="资产呈现方式" className="flex items-center gap-1 bg-surface p-1 rounded-lg border border-glass-border">
            <button
                type="button" aria-pressed={mode === 'static'}
                onClick={(e) => { e.stopPropagation(); onModeChange?.('static'); }}
                className={`min-h-11 flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${mode === 'static'
                    ? 'bg-primary/20 text-primary'
                    : 'text-text-secondary hover:text-foreground'
                    }`}
            >
                <PhotoIcon size={12} />
                {tc("staticMode")}
            </button>
            <button type="button" aria-pressed={mode === 'motion'}
                onClick={(e) => {
                    e.stopPropagation();
                    if (!hasStaticImage) {
                        alert(tc('generateFirstStatic', { type: tc('fullBodyType') }));
                        return;
                    }
                    onModeChange?.('motion');
                }}
                className={`min-h-11 flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${mode === 'motion'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'text-text-secondary hover:text-foreground'
                    }`}
            >
                <Video size={12} />
                {tc("motionMode")}
            </button>
        </div>
    );
}

export function WorkbenchPanel({
    title,
    assetScope,
    previewLocator,
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
    platformPromptSource,
    onPlatformPromptSourceChange,
    onStructuredSelection,
    onDictionaryConfiguration,
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
    hideTitle = false,
    designEditor,
    imageSettings,
    reviewEditorHost,
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
    const [dictionaryHost, setDictionaryHost] = useState<HTMLDivElement | null>(null);
    const tc = useTranslations("character");
    const ti = useTranslations("imageEditor");
    const [mention, setMention] = useState<ReferenceSuggestion | null>(null);
    const [promptSlash, setPromptSlash] = useState<PromptSlashSuggestion | null>(null);
    const [openSlashRequest, setOpenSlashRequest] = useState(0);
    const slashKeyHandler = useRef<((event: globalThis.KeyboardEvent) => boolean) | null>(null);
    const mentionQuery = mention?.query.toLocaleLowerCase() ?? "";
    const matchingReferenceCandidates = referenceCandidates.filter((candidate: ReferenceCandidate) =>
        [candidate.label, candidate.description, candidate.sourceLabel, candidate.variantLabel]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(mentionQuery)),
    );

    const imageEditor = <div>
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
                {!isVideo && !designEditor && <div className="px-4 pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={isLocked} onMouseDown={event => event.preventDefault()} onClick={() => { setOpenSlashRequest((value) => value + 1); }}
                            className="min-h-11 rounded border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">面板与模板</button>
                    </div>
                    {platformPromptSource && <p className="mt-1 break-words text-[11px] text-text-muted" aria-label="平台 Prompt 来源">
                        来源：{platformPromptSource.title} · r{platformPromptSource.revision}
                        {platformPromptSource.customized ? " · 已由用户修改" : " · 当前草稿"}
                    </p>}
                </div>}
                <div className="relative min-h-[150px] flex-1 p-4">
                    <ReferencePromptEditor
                        value={prompt}
                        candidates={referenceCandidates}
                        onChange={(text) => {
                            setPrompt(text);
                            if (platformPromptSource && onPlatformPromptSourceChange && text !== platformPromptSource.appliedText) {
                                onPlatformPromptSourceChange({ ...platformPromptSource, customized: true });
                            }
                        }}
                        onReferencesChange={onReferencesChange}
                        onMentionChange={(next) => {
                            if (next && !mention) onRefreshReferences?.();
                            setMention(next);
                        }}
                        onSlashChange={!isVideo && !designEditor ? (next) => { setPromptSlash(next); if (next) setMention(null); } : undefined}
                        onSlashKeyDown={(event) => slashKeyHandler.current?.(event) || false}
                        openSlashRequest={openSlashRequest}
                        allowImplicitMentions={false}
                        pruneUnlistedReferences
                        expanded
                        editable={!isLocked}
                        placeholder={isVideo ? "输入视频 Prompt，@ 检索资产" : designEditor ? "本次出图提示词，@ 检索资产" : "输入 Prompt，/ 打开面板与模板，@ 检索资产"}
                    />
                    {!isVideo && !designEditor && !isLocked && promptSlash && <CharacterPromptDictionary suggestion={promptSlash} onClose={() => setPromptSlash(null)}
                        onConfiguration={designEditor ? undefined : onDictionaryConfiguration} keyHandler={slashKeyHandler}
                        onApply={(text, entry) => {
                            setPrompt(text);
                            if (!designEditor && entry.structuredFields) onStructuredSelection?.(text, entry.structuredFields, entry.remainingText);
                            if (entry.resource) onPlatformPromptSourceChange?.({ resourceId: entry.resource.platform_resource_id,
                                revision: entry.resource.revision, title: entry.title, appliedText: text, customized: false });
                        }} />}
                    {mention && (
                        <div
                            role="listbox"
                            aria-label="资产检索"
                            className="absolute bottom-full left-3 z-50 mb-2 max-h-64 w-[min(100%-1.5rem,24rem)] overflow-y-auto rounded-xl border border-glass-border bg-elevated p-2 shadow-2xl"
                        >
                            <div className="px-2 pb-1.5 pt-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">项目参考图</div>
                            {matchingReferenceCandidates.length === 0 ? (
                                <div className="px-2 py-2 text-xs text-text-muted">
                                    没有匹配的参考资产
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
                {imageSettings}
        </div>;
    return (
        <CharacterDictionaryHost.Provider value={reviewEditorHost || dictionaryHost}>
        <div
            className={`min-w-0 min-h-0 flex-1 flex flex-col transition-colors ${isActive ? 'bg-glass' : 'bg-transparent hover:bg-hover-bg'}`}
            onClick={onClick}
        >
            {/* Panel Header */}
            {hideTitle ? <h3 className="sr-only">{title}</h3> : <div className="p-4 border-b border-border-subtle">
                <div className="flex items-center justify-between mb-1">
                    <h3 className={`font-bold text-sm uppercase tracking-wider ${isActive ? 'text-primary' : 'text-text-secondary'}`}>
                        {title}
                    </h3>

                    {/* Mode Switcher (Asset Activation v2) */}
                    {supportsMotion && (
                        <CharacterPresentationSwitch mode={mode} onModeChange={onModeChange} hasStaticImage={hasStaticImage} />
                    )}
                </div>
                <p className="text-xs text-text-muted">{description}</p>
            </div>}

            {/* Image Area with Variant Selector */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row-reverse">
            <div ref={setDictionaryHost} data-testid="character-main-workspace" className="flex-1 min-h-0 min-w-0 relative bg-surface p-4 flex flex-col overflow-hidden group">

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
                            viewerClassName="max-h-[min(64dvh,760px)] min-h-[240px]"
                            previewLocator={previewLocator}
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

            {/* Task-specific generation inputs sit beside the image on wide screens. */}
            <div className="min-h-[180px] max-h-[42%] shrink-0 border-t border-glass-border flex flex-col overflow-y-auto bg-surface lg:max-h-none lg:min-h-0 lg:w-[min(34%,440px)] lg:border-r lg:border-t-0">
                {designEditor}
                {designEditor ? reviewEditorHost && createPortal(imageEditor, reviewEditorHost) : imageEditor}

            </div>
            </div>
        </div>
        </CharacterDictionaryHost.Provider>
    );
}
