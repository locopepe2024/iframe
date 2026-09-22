"use client";
/**
 * CastWorkbenchModal — generate / iterate / pick the reference image for a
 * single Cast entity (character | scene | prop).
 *
 * Design intent (per design grill 2026-05-26):
 *   · One prompt — the legacy headshot/full_body/three_view triplet is fused
 *     into a single 'character reference sheet' composition for characters.
 *     Scenes and props each have their own template too.
 *   · Prompt template is pre-filled (entity name + entity description +
 *     composition guidance) but fully editable. The art-direction style is
 *     shown read-only above the textarea since it gets concatenated by
 *     the backend (apply_style=true).
 *   · Generated variants land in a side gallery; clicking one selects it
 *     as the entity's reference image (calls selectAssetVariant). Multiple
 *     re-rolls accumulate so the user can compare.
 *   · Per-project toast surfaces success/error across the long round-trip
 *     (asset generation can take 20-60s).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Loader2, Check, RefreshCw, Wand2, Palette, Star, Upload, Trash2, Library, Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { api, type AssetLibraryReference } from "@/lib/api";
import { useProjectStore, IMAGE_MODELS } from "@/store/projectStore";
import { resolveAssetGenerationModel } from "@/lib/modelCatalog";
import { toast } from "@/store/toastStore";
import { getAssetUrl } from "@/lib/utils";
import PreviewImage from "@/components/shared/preview/PreviewImage";
import GroupedModelGrid from "@/components/common/GroupedModelGrid";

const ImageEditor = dynamic(() => import("@/components/shared/image-editor/ImageEditor"), { ssr: false });

export type CastKind = "character" | "scene" | "prop";

// Module-level poll registry — survives modal close/reopen.
export const activePolls = new Map<string, ReturnType<typeof setInterval>>();

function startAssetPoll(
    entityId: string,
    taskId: string,
    projectId: string,
    kind: CastKind,
    generationType: string,
    t: ReturnType<typeof useTranslations<"castWorkbench">>,
    getStore: () => {
        updateProject: (id: string, data: any) => void;
        removeGeneratingTask: (assetId: string, generationType: string) => void;
    },
    progressToastId?: string,
) {
    if (activePolls.has(entityId)) return;
    const interval = setInterval(async () => {
        try {
            const status = await api.getTaskStatus(taskId);
            if (status?.status === "completed") {
                clearInterval(interval);
                activePolls.delete(entityId);
                if (progressToastId) toast.dismiss(progressToastId);
                const fresh = await api.getProject(projectId);
                const { updateProject, removeGeneratingTask } = getStore();
                updateProject(projectId, fresh);
                removeGeneratingTask(entityId, generationType);
                const entityPool = (kind === "character" ? fresh.characters : kind === "scene" ? fresh.scenes : fresh.props) || [];
                const updatedEntity = entityPool.find((e: any) => e.id === entityId);
                const count = updatedEntity ? readVariants(updatedEntity, kind).length : 0;
                toast.success(t("toastVariantDone"), { body: t("toastVariantDoneBody", { count }) });
            } else if (status?.status === "failed") {
                clearInterval(interval);
                activePolls.delete(entityId);
                if (progressToastId) toast.dismiss(progressToastId);
                const { removeGeneratingTask } = getStore();
                removeGeneratingTask(entityId, generationType);
                toast.error(t("toastGenErr"), { body: status?.error || t("toastGenErrUnknown") });
            }
        } catch (err) {
            clearInterval(interval);
            activePolls.delete(entityId);
            if (progressToastId) toast.dismiss(progressToastId);
            const { removeGeneratingTask } = getStore();
            removeGeneratingTask(entityId, generationType);
            toast.error(t("toastPollErr"), { body: t("toastPollErrBody") });
        }
    }, 2500);
    activePolls.set(entityId, interval);
}

interface CastWorkbenchModalProps {
    isOpen: boolean;
    kind: CastKind | null;
    entityId: string | null;
    onClose: () => void;
}

interface ImageVariant {
    id: string;
    url: string;
    is_favorited?: boolean;
    reference_view_role?: string;
    reference_distance?: string;
}

interface ReferenceLibraryAsset {
    asset_type: CastKind;
    asset_id: string;
    name: string;
    source?: "episode" | "series" | "global";
    variants: ImageVariant[];
}

type CharacterTemplate = "simple" | "detailed" | "design_sheet";

const CHARACTER_TEMPLATES: Record<CharacterTemplate, {
    labelKey: string;
    descKey: string;
    composition: string;
    negativeAppend: string;
    comingSoon?: boolean;
    exampleImage?: string;
}> = {
    simple: {
        labelKey: "tplSimpleLabel",
        descKey: "tplSimpleDesc",
        composition: "构图：单张统一的角色参考图，无边框或分隔框，浅灰色中性背景。左半部分为头部近景肖像（肩部以上，正面朝向，面部细节清晰）；右半部分为三个等大的全身站立姿势，依次展示正面、侧面和背面，从头到脚完整可见，姿势放松自然。所有视图使用统一的柔和摄影棚光线，避免硬阴影，光照均匀。",
        negativeAppend: "text, labels, watermark, UI overlay, panel borders, frames, multiple separate images",
        exampleImage: "/assets/templates/simple-triview.png",
    },
    detailed: {
        labelKey: "tplDetailedLabel",
        descKey: "tplDetailedDesc",
        composition: "构图：单张统一的详细角色参考图，无边框或分隔框，浅灰色中性背景。左侧为三个并排的全身站立视图，依次展示正面、侧面和背面，从头到脚完整可见，姿势放松自然；右上为头部近景肖像（肩部以上，面部细节清晰）；右下为三个较小的头部角度特写，展示正面、四分之三侧面和侧面。所有视图使用统一的柔和摄影棚光线，避免硬阴影，整体光照均匀。",
        negativeAppend: "text, labels, watermark, UI overlay, panel borders, frames, multiple separate images",
        exampleImage: "/assets/templates/detailed-reference.png",
    },
    design_sheet: {
        labelKey: "tplDesignSheetLabel",
        descKey: "tplDesignSheetDesc",
        composition: "构图：专业角色设定图，单张统一画面，深蓝黑色赛博朋克主题背景，带有低调的霓虹电路纹理。画面分为带细边框的标注区域：左上为大幅角色肖像（半身、四分之三角度、情绪化轮廓光）；中间为正面、侧面和背面三个全身站立视图；右上为四个表情特写；左下为眼部、颈部纹身、服装材质和装备等细节特写；右下为包含姓名、年龄、特征和能力的角色信息区。电影感光线，高细节，概念设计质量。",
        negativeAppend: "watermark, UI overlay, signature, low quality, distorted anatomy, multiple separate images",
        comingSoon: true,
        exampleImage: "/assets/templates/design-sheet.png",
    },
};

function buildTemplate(kind: CastKind, entity: any, template?: CharacterTemplate): string {
    const name = entity?.name || "";
    const desc = entity?.description || "";
    const charDesc = `${name}${desc ? "，" + desc : ""}`;

    if (kind === "character") {
        const tpl = CHARACTER_TEMPLATES[template || "simple"];
        return `${charDesc}\n\n${tpl.composition}`;
    }
    if (kind === "scene") {
        return `${name}${desc ? "：" + desc : ""}\n\n构图：中性灰背景下的环境广角定调镜头，单张统一画面，前景不出现人物。突出氛围、建筑和地形结构，光线与色调贴合场景情绪，使用柔和的体积光和适度景深。`;
    }
    return `${name}${desc ? "：" + desc : ""}\n\n构图：中性灰背景下的产品摄影风格，单张统一画面，无边框或分隔框。主体以轻微侧角居中展示，并辅以材质和纹理的细节特写。使用干净均匀的摄影棚光线，在主体下方保留轻微自然阴影。`;
}

function getTemplateNegative(kind: CastKind, template?: CharacterTemplate): string {
    if (kind === "character") {
        const tpl = CHARACTER_TEMPLATES[template || "simple"];
        return tpl.negativeAppend;
    }
    return "text, labels, watermark, UI overlay, panel borders, frames";
}

/** Variants live in different slots depending on kind + legacy schema:
 *  · character → reference_sheet.image_variants (new) or full_body_asset.variants (legacy)
 *  · scene → image_asset.variants
 *  · prop → image_asset.variants
 *  Returns a normalized [{id, url, is_favorited?}] list. */
function readVariants(entity: any, kind: CastKind): ImageVariant[] {
    if (!entity) return [];
    if (kind === "character") {
        const sheet = entity?.reference_sheet?.image_variants ?? [];
        if (sheet.length > 0) {
            return sheet.map((v: any) => ({ id: v.id, url: v.url, is_favorited: v.is_favorited, reference_view_role: v.reference_view_role, reference_distance: v.reference_distance }));
        }
        const legacy = entity?.full_body_asset?.variants ?? [];
        return legacy.map((v: any) => ({ id: v.id, url: v.url, is_favorited: v.is_favorited, reference_view_role: v.reference_view_role, reference_distance: v.reference_distance }));
    }
    const arr = entity?.image_asset?.variants ?? [];
    return arr.map((v: any) => ({ id: v.id, url: v.url, is_favorited: v.is_favorited, reference_view_role: v.reference_view_role, reference_distance: v.reference_distance }));
}

/**
 * The Cast gallery intentionally prefers the canonical character sheet, but
 * an asset-library picker must expose every reusable character image variant.
 * Older records may only have a full-body, three-view, or headshot container.
 */
function readLibraryVariants(entity: any, kind: CastKind): ImageVariant[] {
    if (!entity) return [];
    if (kind !== "character") return readVariants(entity, kind);

    const containers = [
        entity?.reference_sheet?.image_variants,
        entity?.full_body_asset?.variants,
        entity?.three_view_asset?.variants,
        entity?.headshot_asset?.variants,
    ];
    const seen = new Set<string>();
    return containers.flatMap((items: any[] | undefined) => (items || []).flatMap((v: any) => {
        if (!v?.id || seen.has(v.id)) return [];
        seen.add(v.id);
        return [{
            id: v.id,
            url: v.url,
            is_favorited: v.is_favorited,
            reference_view_role: v.reference_view_role,
            reference_distance: v.reference_distance,
        }];
    }));
}

function readSelectedId(entity: any, kind: CastKind): string | null {
    if (!entity) return null;
    if (kind === "character") {
        return entity?.reference_sheet?.selected_image_id
            ?? entity?.full_body_asset?.selected_id
            ?? null;
    }
    return entity?.image_asset?.selected_id ?? null;
}

export default function CastWorkbenchModal({ isOpen, kind, entityId, onClose }: CastWorkbenchModalProps) {
    const t = useTranslations("castWorkbench");
    const locale = useLocale();
    const currentProject = useProjectStore((state) => state.currentProject);
    const currentSeries = useProjectStore((state) => state.currentSeries);
    const allProjects = useProjectStore((state) => state.projects);
    const updateProject = useProjectStore((state) => state.updateProject);
    const generatingTasks = useProjectStore((state) => state.generatingTasks);
    const addGeneratingTask = useProjectStore((state) => state.addGeneratingTask);
    const removeGeneratingTask = useProjectStore((state) => state.removeGeneratingTask);

    // Look up the live entity from the store so it stays in sync after
    // generation calls patch the project.
    const entity = useMemo(() => {
        if (!entityId || !kind || !currentProject) return null;
        const pool: any[] = kind === "character"
            ? currentProject.characters || []
            : kind === "scene"
                ? currentProject.scenes || []
                : currentProject.props || [];
        return pool.find((e: any) => e.id === entityId) ?? null;
    }, [currentProject, entityId, kind]);

    const variants = useMemo(() => readVariants(entity, kind ?? "character"), [entity, kind]);
    const selectedId = useMemo(() => readSelectedId(entity, kind ?? "character"), [entity, kind]);

    const uploadInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [batchSize, setBatchSize] = useState(2);
    const [aspectRatioOverride, setAspectRatioOverride] = useState<string | null>(null);
    const [modelOverride, setModelOverride] = useState<string | null>(null);
    const [positiveExpanded, setPositiveExpanded] = useState(false);
    const [negativeExpanded, setNegativeExpanded] = useState(false);
    const [modelPromptExpanded, setModelPromptExpanded] = useState(false);
    const [applyStyle, setApplyStyle] = useState(true);
    const [galleryFilter, setGalleryFilter] = useState<"all" | "favorited">("all");
    const [deletingVariantId, setDeletingVariantId] = useState<string | null>(null);
    const [editingVariant, setEditingVariant] = useState<ImageVariant | null>(null);
    const [libraryReference, setLibraryReference] = useState<AssetLibraryReference | null>(null);
    const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
    const [globalLibraryAssets, setGlobalLibraryAssets] = useState<{
        characters: any[];
        scenes: any[];
        props: any[];
    }>({ characters: [], scenes: [], props: [] });
    const generating = generatingTasks.some((t) => t.assetId === entityId);
    // Resolve the selected model against the current live catalog before both
    // rendering and submitting. A project can retain a SKU that was removed
    // upstream (for example `gpt-image-2.5-flare`); using that raw value here
    // would bypass the refreshed selector and submit the retired SKU anyway.
    const requestedModelId = modelOverride || currentProject?.model_settings?.t2i_model;
    const selectedModelId = resolveAssetGenerationModel(requestedModelId);
    const isGptImage2 = selectedModelId === "gpt-image-2" || selectedModelId === "uniart/gpt-image-2";
    const [selectedTemplate, setSelectedTemplate] = useState<CharacterTemplate>("simple");
    const [pendingTemplate, setPendingTemplate] = useState<CharacterTemplate | null>(null);
    const [promptDirty, setPromptDirty] = useState(false);
    const lastSeededEntityId = useRef<string | null>(null);
    const overlayMouseDown = useRef(false);

    useEffect(() => {
        if (!isOpen) return;
        // A normal GET /projects response already merges series/global assets,
        // but a freshly-created or cached project can predate that merge. Load
        // the global pool opportunistically so the picker remains complete;
        // the current project/series data still renders immediately.
        const loadGlobalAssets = api.listLibraryAssets;
        if (typeof loadGlobalAssets !== "function") return;
        let request: unknown;
        try {
            request = loadGlobalAssets();
        } catch {
            return;
        }
        void Promise.resolve(request)
            .then((data: any) => {
                setGlobalLibraryAssets({
                    characters: data?.characters || [],
                    scenes: data?.scenes || [],
                    props: data?.props || [],
                });
            })
            .catch(() => {
                // The current project response is still a valid source when
                // the optional global-library read is unavailable.
            });
    }, [isOpen]);

    const referenceLibraryAssets = useMemo<ReferenceLibraryAsset[]>(() => {
        if (!currentProject) return [];
        const byKey = new Map<string, ReferenceLibraryAsset>();
        const addGroup = (assetType: CastKind, assets: any[], fallbackSource?: ReferenceLibraryAsset["source"]) => {
            for (const asset of assets || []) {
                const variants = readLibraryVariants(asset, assetType);
                if (!asset?.id || variants.length === 0) continue;
                const key = `${assetType}:${asset.id}`;
                // Episode-local/project response data has priority over the
                // parent series and global fallback pools.
                if (byKey.has(key)) continue;
                byKey.set(key, {
                    asset_type: assetType,
                    asset_id: asset.id,
                    name: asset.name,
                    source: asset.source || fallbackSource,
                    variants,
                });
            }
        };

        addGroup("character", currentProject.characters || [], "episode");
        addGroup("scene", currentProject.scenes || [], "episode");
        addGroup("prop", currentProject.props || [], "episode");
        addGroup("character", currentSeries?.characters || [], "series");
        addGroup("scene", currentSeries?.scenes || [], "series");
        addGroup("prop", currentSeries?.props || [], "series");
        addGroup("character", globalLibraryAssets.characters, "global");
        addGroup("scene", globalLibraryAssets.scenes, "global");
        addGroup("prop", globalLibraryAssets.props, "global");
        return Array.from(byKey.values());
    }, [currentProject, currentSeries, globalLibraryAssets]);

    const selectedLibraryAsset = useMemo(() => {
        if (!libraryReference) return null;
        const asset = referenceLibraryAssets.find((item) =>
            item.asset_type === libraryReference.asset_type && item.asset_id === libraryReference.asset_id,
        );
        const variant = asset?.variants.find((item) => item.id === libraryReference.variant_id);
        return asset && variant ? { asset, variant } : null;
    }, [libraryReference, referenceLibraryAssets]);

    // Reset prompt to template ONLY when the entity changes (not on every
    // open) so the user's in-flight edits aren't clobbered if they happen
    // to flip the modal closed and back. Clearing happens via the reset
    // button or kind/entity switch.
    useEffect(() => {
        if (!isOpen || !entity || !kind) return;
        if (lastSeededEntityId.current !== entity.id) {
            setPrompt(buildTemplate(kind, entity, selectedTemplate));
            setPromptDirty(false);
            lastSeededEntityId.current = entity.id;
        }
    }, [isOpen, entity, kind, selectedTemplate]);

    useEffect(() => {
        setLibraryReference(null);
        setLibraryPickerOpen(false);
    }, [currentProject?.id, entity?.id, kind]);

    const [presets, setPresets] = useState<any[]>([]);
    useEffect(() => {
        api.getStylePresets().then((res: any) => setPresets(res?.presets || res || [])).catch(() => {});
    }, []);

    if (!isOpen || !kind || !entity || !currentProject) return null;

    const resolvedArtDirection = currentProject.art_direction ?? currentSeries?.art_direction;
    const styleConfig = resolvedArtDirection?.style_config;
    const styleName = styleConfig?.name || "";
    const styleNegative = styleConfig?.negative_prompt || "";
    const matchedStyle = styleConfig?.id
        ? presets.find((preset: any) => preset.id === styleConfig.id)
        : undefined;
    const styleDisplayName = locale.startsWith("zh")
        ? matchedStyle?.name_zh || (styleConfig?.is_custom || !styleConfig?.id ? styleName : t("styleConfigured"))
        : styleName || matchedStyle?.name || "";
    const styleDescription = locale.startsWith("zh")
        ? matchedStyle?.subtitle_zh || matchedStyle?.description || ""
        : matchedStyle?.description || "";
    // Resolve positive_prompt with preset fallback (series data often omits it)
    let stylePositive = styleConfig?.positive_prompt || "";
    if (!stylePositive && styleConfig?.id && presets.length > 0) {
        const match = presets.find((p: any) => p.id === styleConfig.id);
        if (match) stylePositive = match.prompt || match.positive_prompt || "";
    }

    const ms = currentProject.model_settings;
    const defaultAspectRatio = kind === "character"
        ? (ms?.character_aspect_ratio || "9:16")
        : kind === "scene"
            ? (ms?.scene_aspect_ratio || "16:9")
            : (ms?.prop_aspect_ratio || "1:1");
    const effectiveAspectRatio = aspectRatioOverride || defaultAspectRatio;

    const handleResetTemplate = () => {
        setPrompt(buildTemplate(kind, entity, selectedTemplate));
        setPromptDirty(false);
    };

    const handleTemplateSwitch = (tpl: CharacterTemplate) => {
        if (tpl === selectedTemplate) return;
        // design_sheet (comingSoon) is gated on gpt-image-2 — the button
        // unlocks when isGptImage2, so allow the switch too.
        if (CHARACTER_TEMPLATES[tpl].comingSoon && !isGptImage2) return;
        if (promptDirty) {
            setPendingTemplate(tpl);
        } else {
            setSelectedTemplate(tpl);
            setPrompt(buildTemplate(kind, entity, tpl));
            setPromptDirty(false);
        }
    };

    const confirmTemplateSwitch = () => {
        if (!pendingTemplate) return;
        setSelectedTemplate(pendingTemplate);
        setPrompt(buildTemplate(kind, entity, pendingTemplate));
        setPromptDirty(false);
        setPendingTemplate(null);
    };

    const cancelTemplateSwitch = () => {
        setPendingTemplate(null);
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            toast.warning(t("toastPromptEmpty"), {
                projectId: currentProject.id,
                projectTitle: currentProject.title,
            });
            return;
        }
        // Refresh project + validate the entity still exists backend-side
        // before submitting. The store can hold a stale character that was
        // deleted server-side, which makes generateAsset 404 with
        // "Character {id} not found". Syncing here both prevents the 404
        // and self-heals the store so the stale card disappears.
        try {
            const fresh = await api.getProject(currentProject.id);
            const pool = kind === "character" ? fresh.characters : kind === "scene" ? fresh.scenes : fresh.props;
            if (!Array.isArray(pool) || !pool.some((e: any) => e.id === entity.id)) {
                toast.error(t("toastEntityGone"), {
                    projectId: currentProject.id,
                    projectTitle: currentProject.title,
                });
                updateProject(currentProject.id, fresh);
                onClose();
                return;
            }
            updateProject(currentProject.id, fresh);
        } catch {
            // Refresh failed — proceed with cached data; backend will reject
            // if the entity truly is stale and the poll surfaces the error.
        }
        const effectiveBatchSize = Math.max(1, Math.min(4, batchSize));
        addGeneratingTask(entity.id, kind === "character" ? "reference_sheet" : "all", effectiveBatchSize);

        const progressId = toast.progress(t("toastGenStart", { kind: t(`kind.${kind}`) }), {
            projectId: currentProject.id,
            projectTitle: currentProject.title,
            body: t("toastGenStartBody"),
        });

        try {
            const resp = await api.generateAsset(
                currentProject.id,
                entity.id,
                kind,
                currentProject.style_preset || "realistic",
                applyStyle ? stylePositive : "",
                kind === "character" ? "reference_sheet" : "all",
                prompt.trim(),
                applyStyle,
                [applyStyle ? styleNegative : "", getTemplateNegative(kind, selectedTemplate)].filter(Boolean).join(", "),
                effectiveBatchSize,
                selectedModelId,
                aspectRatioOverride || undefined,
                libraryReference ?? undefined,
            );

            const taskId = (resp as any)?._task_id;
            if (taskId) {
                const capturedEntityId = entity.id;
                const capturedKind = kind;
                const capturedProjectId = currentProject.id;
                startAssetPoll(capturedEntityId, taskId, capturedProjectId, capturedKind, kind === "character" ? "reference_sheet" : "all", t, () => ({
                    updateProject: useProjectStore.getState().updateProject,
                    removeGeneratingTask: useProjectStore.getState().removeGeneratingTask,
                }), progressId);
            } else if (resp) {
                toast.dismiss(progressId);
                updateProject(currentProject.id, resp);
                removeGeneratingTask(entity.id, kind === "character" ? "reference_sheet" : "all");
                toast.success(t("toastGenDone", { kind: t(`kind.${kind}`) }));
            }
        } catch (err: any) {
            toast.dismiss(progressId);
            removeGeneratingTask(entity.id, kind === "character" ? "reference_sheet" : "all");
            const detail = err?.response?.data?.detail || err?.message || t("toastGenErrUnknown");
            toast.error(t("toastGenErr"), { body: String(detail) });
        }
    };

    const handleUpload = async (file?: File) => {
        if (!file || uploading) return;
        setUploading(true);
        try {
            const updated = await api.uploadAsset(currentProject.id, kind, entity.id, file,
                kind === "character" ? "reference_sheet" : "image");
            updateProject(currentProject.id, updated);
            setLibraryReference(null);
            setLibraryPickerOpen(false);
            setGalleryFilter("all");
            toast.success(t("uploadSuccess"));
        } catch (err: any) {
            toast.error(t("uploadFailed"), { body: String(err?.message || t("toastGenErrUnknown")) });
        } finally {
            setUploading(false);
        }
    };

    const handleSaveEditedVariant = async (file: File) => {
        if (!currentProject || !editingVariant || kind !== "character") return;
        setUploading(true);
        try {
            const updated = await api.uploadAsset(
                currentProject.id,
                "character",
                entity!.id,
                file,
                "reference_sheet",
            );
            updateProject(currentProject.id, updated);
            setEditingVariant(null);
            toast.success(t("uploadSuccess"));
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err?.message || t("toastGenErrUnknown");
            toast.error(t("uploadFailed"), { body: String(detail) });
            throw err;
        } finally {
            setUploading(false);
        }
    };

    const handleChooseLibraryVariant = (asset: ReferenceLibraryAsset, variant: ImageVariant) => {
        setLibraryReference({
            asset_type: asset.asset_type,
            asset_id: asset.asset_id,
            variant_id: variant.id,
        });
        setLibraryPickerOpen(false);
    };

    const handleClearLibraryReference = () => {
        setLibraryReference(null);
    };

    const handleSelectVariant = async (variantId: string) => {
        try {
            const updated = await api.selectAssetVariant(
                currentProject.id,
                entity.id,
                kind,
                variantId,
                kind === "character" && entity.reference_sheet?.image_variants?.some((v: ImageVariant) => v.id === variantId) ? "reference_sheet" : undefined,
            );
            updateProject(currentProject.id, updated);
            toast.success(t("toastSelected"), {
                projectId: currentProject.id,
                projectTitle: currentProject.title,
                autoCloseMs: 3000,
            });
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err?.message || "select failed";
            toast.error(t("toastSelectErr"), {
                projectId: currentProject.id,
                projectTitle: currentProject.title,
                body: String(detail),
            });
        }
    };

    const handleToggleFavorite = async (variantId: string, currentFav: boolean) => {
        try {
            const updated = await api.favoriteAssetVariant(
                currentProject.id,
                entity.id,
                kind,
                variantId,
                !currentFav,
            );
            updateProject(currentProject.id, updated);
        } catch { /* silent — non-critical */ }
    };

    const handleDeleteVariant = async (variantId: string) => {
        if (deletingVariantId || !window.confirm(t("confirmDeleteVariant"))) return;
        setDeletingVariantId(variantId);
        try {
            const updated = await api.deleteAssetVariant(currentProject.id, entity.id, kind, variantId);
            updateProject(currentProject.id, updated);
            toast.success(t("toastDeleted"), {
                projectId: currentProject.id,
                projectTitle: currentProject.title,
            });
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err?.message || t("toastGenErrUnknown");
            toast.error(t("toastDeleteErr"), { body: String(detail) });
        } finally {
            setDeletingVariantId(null);
        }
    };

    const handleUpdateViewMetadata = async (
        variant: ImageVariant,
        patch: Partial<Pick<ImageVariant, "reference_view_role" | "reference_distance">>,
    ) => {
        try {
            const updated = await api.updateAssetVariantMetadata(
                currentProject.id,
                entity.id,
                kind,
                variant.id,
                patch.reference_view_role ?? variant.reference_view_role,
                patch.reference_distance ?? variant.reference_distance,
            );
            updateProject(currentProject.id, updated);
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err?.message || t("toastGenErrUnknown");
            toast.error(t("toastMetadataErr"), { body: String(detail) });
        }
    };

    const filteredVariants = galleryFilter === "favorited"
        ? variants.filter(v => v.is_favorited)
        : variants;
    const compositionSummary = kind === "character"
        ? t(CHARACTER_TEMPLATES[selectedTemplate].descKey)
        : t(kind === "scene" ? "promptHintScene" : "promptHintProp");

    // Per-kind accent — Tailwind JIT can't resolve dynamic `bg-${name}-500/15`,
    // so we ship full class strings per kind keyed off a static record.
    const accentClasses = {
        character: {
            headerPill: "bg-purple-500/15 text-purple-300 border-purple-500/30",
            batchActive: "border-purple-400/60 bg-purple-500/15 text-purple-200",
            variantSelected: "border-purple-400 ring-2 ring-purple-500/40",
            selectBadge: "bg-purple-500",
        },
        scene: {
            headerPill: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
            batchActive: "border-emerald-400/60 bg-emerald-500/15 text-emerald-200",
            variantSelected: "border-emerald-400 ring-2 ring-emerald-500/40",
            selectBadge: "bg-emerald-500",
        },
        prop: {
            headerPill: "bg-amber-500/15 text-amber-300 border-amber-500/30",
            batchActive: "border-amber-400/60 bg-amber-500/15 text-amber-200",
            variantSelected: "border-amber-400 ring-2 ring-amber-500/40",
            selectBadge: "bg-amber-500",
        },
    } as const;
    const accent = accentClasses[kind];

    return createPortal((
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-overlay backdrop-blur-sm grid place-items-center p-4"
                onMouseDown={(e) => { overlayMouseDown.current = e.target === e.currentTarget; }}
                onMouseUp={(e) => { if (overlayMouseDown.current && e.target === e.currentTarget) onClose(); overlayMouseDown.current = false; }}
            >
                <motion.div
                    initial={{ scale: 0.96, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.96, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="w-[85vw] max-w-[96rem] h-[92vh] flex flex-col rounded-2xl border border-glass-border bg-elevated shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)] overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-glass-border">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md border shrink-0 ${accent.headerPill}`}>
                                <Sparkles size={13} />
                            </span>
                            <div className="min-w-0">
                                <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-text-muted">
                                    {t(`kind.${kind}`)} · {variants.length} {t("variants")}
                                </p>
                                <h2 className="text-display font-medium text-foreground truncate">{entity.name}</h2>
                            </div>
                        </div>
                        <button onClick={onClose} aria-label={t("close")} className="p-1.5 rounded-lg hover:bg-hover-bg text-text-muted hover:text-foreground transition-colors">
                            <X size={15} />
                        </button>
                    </header>

                    {/* Body: context (left) + prompt editor (center) + variants gallery (right) */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1.2fr)] divide-x divide-glass-border min-h-0">
                        {/* LEFT — entity context + style baseline + current reference */}
                        <div className="hidden md:flex flex-col gap-3 p-4 overflow-y-auto custom-scrollbar bg-surface/50">
                            {/* Entity metadata */}
                            <div>
                                <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted mb-1">
                                    {t(`kind.${kind}`)}
                                </p>
                                <p className="text-[0.875rem] font-medium text-foreground">{entity.name}</p>
                                {entity.description && (
                                    <p className="mt-1.5 text-[0.75rem] leading-relaxed text-text-secondary">
                                        {entity.description}
                                    </p>
                                )}
                            </div>

                            {/* Entity associations — which episodes */}
                            {(() => {
                                const seriesId = currentProject.series_id;
                                if (!seriesId) return null;
                                const siblingEpisodes = allProjects.filter((p: any) => p.series_id === seriesId);
                                const appearsIn = siblingEpisodes.filter((ep: any) => {
                                    const pool: any[] = kind === "character"
                                        ? ep.characters || []
                                        : kind === "scene" ? ep.scenes || [] : ep.props || [];
                                    return pool.some((e: any) => e.id === entity.id || e.name === entity.name);
                                });
                                if (appearsIn.length <= 1) return null;
                                return (
                                    <div className="pt-3 border-t border-glass-border">
                                        <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted mb-1.5">
                                            {t("appearsIn")} ({appearsIn.length})
                                        </p>
                                        <div className="flex flex-wrap gap-1">
                                            {appearsIn.slice(0, 6).map((ep: any) => (
                                                <span key={ep.id} className="px-1.5 py-0.5 rounded bg-elevated border border-glass-border text-[0.625rem] text-text-secondary truncate max-w-[110px]">
                                                    {ep.title}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Style baseline — name + toggle + positive/negative prompts */}
                            <div className="pt-3 border-t border-glass-border">
                                <div className="flex items-center justify-between">
                                    <p className="flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                        <Palette size={10} /> {t("styleAppliedFrom")}
                                    </p>
                                    {styleDisplayName && (
                                        <button
                                            onClick={() => setApplyStyle(!applyStyle)}
                                            className={`relative w-7 h-4 rounded-full transition-colors ${applyStyle ? "bg-primary/60" : "bg-elevated"}`}
                                        >
                                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${applyStyle ? "left-3.5" : "left-0.5"}`} />
                                        </button>
                                    )}
                                </div>
                                <p className="mt-1 text-[0.75rem] text-foreground">{styleDisplayName || t("styleNotSet")}</p>
                                {styleDescription && styleDisplayName && (
                                    <p className="mt-0.5 text-[0.625rem] leading-relaxed text-text-secondary">
                                        {styleDescription}
                                    </p>
                                )}
                                {!applyStyle && styleDisplayName && (
                                    <p className="text-[0.625rem] text-amber-300/70 mt-0.5">{t("styleDisabledHint")}</p>
                                )}

                                {/* Provider-facing prompts stay available for advanced users, but are
                                    hidden from the default customer view so the same description is not
                                    displayed a second time in English. */}
                                {applyStyle && (stylePositive || styleNegative) && (
                                    <>
                                        <button
                                            type="button"
                                            aria-expanded={modelPromptExpanded}
                                            onClick={() => setModelPromptExpanded(!modelPromptExpanded)}
                                            className="mt-2.5 inline-flex items-center gap-1 text-[0.625rem] text-text-muted hover:text-text-secondary transition-colors"
                                        >
                                            <span>{modelPromptExpanded ? t("hideModelPrompts") : t("showModelPrompts")}</span>
                                            <span aria-hidden="true">{modelPromptExpanded ? "−" : "+"}</span>
                                        </button>
                                        {modelPromptExpanded && (
                                            <div className="mt-1.5 space-y-2">
                                                {/* Positive prompt */}
                                                {stylePositive && (
                                                    <div className="rounded-md bg-primary/5 border border-primary/10 px-2.5 py-2">
                                                        <p className="font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-primary/70 mb-1">{t("positiveLabel")}</p>
                                                        <p className={`text-[0.6875rem] leading-relaxed text-text-secondary ${!positiveExpanded ? "line-clamp-3" : ""}`}>
                                                            {stylePositive}
                                                        </p>
                                                        {stylePositive.length > 80 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setPositiveExpanded(!positiveExpanded)}
                                                                className="mt-1 text-[0.625rem] text-primary/60 hover:text-primary/90 transition-colors"
                                                            >
                                                                {positiveExpanded ? t("collapse") : t("expand")}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Negative prompt */}
                                                {styleNegative && (
                                                    <div className="rounded-md bg-red-500/5 border border-red-500/10 px-2.5 py-2">
                                                        <p className="font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-red-400/70 mb-1">{t("negativeLabel")}</p>
                                                        <p className={`text-[0.6875rem] leading-relaxed text-text-secondary ${!negativeExpanded ? "line-clamp-3" : ""}`}>
                                                            {styleNegative}
                                                        </p>
                                                        {styleNegative.length > 80 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setNegativeExpanded(!negativeExpanded)}
                                                                className="mt-1 text-[0.625rem] text-red-400/60 hover:text-red-400/90 transition-colors"
                                                            >
                                                                {negativeExpanded ? t("collapse") : t("expand")}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                        </div>

                        {/* CENTER — template cards → prompt → tags → preview → generation config → CTA */}
                        <div className="flex flex-col p-5 overflow-y-auto custom-scrollbar">
                            {/* Template selection cards — character only */}
                            {kind === "character" && (
                                <div className="mb-4">
                                    <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted mb-2.5">
                                        {t("templateSelectLabel")}
                                    </p>
                                    <div className="flex gap-3">
                                        {(Object.entries(CHARACTER_TEMPLATES) as [CharacterTemplate, typeof CHARACTER_TEMPLATES[CharacterTemplate]][]).map(([key, tpl]) => {
                                            const isActive = selectedTemplate === key;
                                            const isLocked = !!(tpl.comingSoon && !isGptImage2);
                                            return (
                                                <button
                                                    key={key}
                                                    onClick={() => !isLocked && handleTemplateSwitch(key)}
                                                    disabled={isLocked}
                                                    className={`relative flex flex-col rounded-lg border overflow-hidden transition-all flex-1 min-w-0 ${
                                                        isActive
                                                            ? "border-primary/60 ring-1 ring-primary/30 bg-primary/5"
                                                            : isLocked
                                                                ? "border-glass-border bg-black/20 opacity-50 cursor-not-allowed"
                                                                : "border-glass-border bg-black/20 hover:border-foreground/30 hover:bg-hover-bg"
                                                    }`}
                                                >
                                                    {/* Example thumbnail area — 4:3 ratio */}
                                                    <div className="aspect-[4/3] bg-black/30 flex items-center justify-center overflow-hidden">
                                                        {tpl.exampleImage ? (
                                                            <img src={tpl.exampleImage} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <span className="text-[1.25rem] text-text-muted/40">
                                                                {isLocked ? "🔒" : "📐"}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* Label + description */}
                                                    <div className="px-2.5 py-2">
                                                        <p className={`text-[0.6875rem] font-medium ${isActive ? "text-foreground" : "text-text-secondary"}`}>
                                                            {t(tpl.labelKey)}
                                                        </p>
                                                        <p className="text-[0.59375rem] text-text-muted mt-0.5 line-clamp-1">
                                                            {t(tpl.descKey)}
                                                        </p>
                                                    </div>
                                                    {/* Active indicator */}
                                                    {isActive && (
                                                        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary grid place-items-center">
                                                            <Check size={9} className="text-foreground" strokeWidth={3} />
                                                        </span>
                                                    )}
                                                    {isLocked && (
                                                        <span className="absolute top-1.5 right-1.5 text-[0.5625rem] text-text-muted font-mono uppercase">{t("comingSoon")}</span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {/* Inline confirm when switching with dirty prompt */}
                                    {pendingTemplate && (
                                        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                                            <span className="text-[0.6875rem] text-amber-200/90">{t("tplSwitchConfirm")}</span>
                                            <button
                                                onClick={confirmTemplateSwitch}
                                                className="px-2 py-0.5 rounded text-[0.6875rem] font-medium bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 transition-colors"
                                            >
                                                {t("tplSwitchYes")}
                                            </button>
                                            <button
                                                onClick={cancelTemplateSwitch}
                                                className="px-2 py-0.5 rounded text-[0.6875rem] text-text-muted hover:text-text-secondary transition-colors"
                                            >
                                                {t("tplSwitchNo")}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Prompt textarea */}
                            <div className="flex items-center justify-between mb-2">
                                <label className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                    {t("promptLabel")}
                                </label>
                                <button
                                    onClick={handleResetTemplate}
                                    disabled={generating}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.6875rem] text-text-muted hover:text-foreground transition-colors disabled:opacity-30"
                                    title={t("resetTemplateHint")}
                                >
                                    <RefreshCw size={11} />
                                    {t("resetTemplate")}
                                </button>
                            </div>
                            <textarea
                                value={prompt}
                                onChange={(e) => { setPrompt(e.target.value); setPromptDirty(true); }}
                                disabled={generating}
                                className="w-full min-h-[260px] max-h-[400px] rounded-md border border-glass-border bg-black/30 px-3.5 py-2.5 text-[0.875rem] text-foreground placeholder:text-text-muted focus:outline-none focus:border-primary/40 disabled:opacity-60 resize-y leading-relaxed"
                            />

                            {/* Quick tags — immediately below textarea */}
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                                {(kind === "character"
                                    ? [
                                        { key: "fullBody", value: "full body" },
                                        { key: "closeUp", value: "close-up" },
                                        { key: "threeView", value: "three-view" },
                                        { key: "dynamicPose", value: "dynamic pose" },
                                        { key: "softLighting", value: "soft lighting" },
                                        { key: "studioLighting", value: "studio lighting" },
                                        { key: "whiteBackground", value: "white background" },
                                        { key: "detailedFace", value: "detailed face" },
                                    ]
                                    : kind === "scene"
                                        ? [
                                            { key: "wideAngle", value: "wide angle" },
                                            { key: "establishingShot", value: "establishing shot" },
                                            { key: "goldenHour", value: "golden hour" },
                                            { key: "dramaticLighting", value: "dramatic lighting" },
                                            { key: "aerialView", value: "aerial view" },
                                            { key: "depthOfField", value: "depth of field" },
                                            { key: "atmospheric", value: "atmospheric" },
                                            { key: "cinematic", value: "cinematic" },
                                        ]
                                        : [
                                            { key: "productShot", value: "product shot" },
                                            { key: "whiteBackground", value: "white background" },
                                            { key: "multiAngle", value: "multi-angle" },
                                            { key: "studioLighting", value: "studio lighting" },
                                            { key: "macroDetail", value: "macro detail" },
                                            { key: "floating", value: "floating" },
                                            { key: "transparentBackground", value: "transparent background" },
                                            { key: "clean", value: "clean" },
                                        ]
                                ).map((tag) => (
                                    <button
                                        key={tag.key}
                                        onClick={() => setPrompt((p) => p.trimEnd() + (p.endsWith(",") || p.endsWith("，") || !p.trim() ? " " : ", ") + tag.value)}
                                        disabled={generating}
                                        className="px-2.5 py-1 rounded border border-glass-border bg-glass text-[0.6875rem] text-text-muted hover:text-text-secondary hover:border-foreground/30 hover:bg-hover-bg transition-colors disabled:opacity-30"
                                    >
                                        + {t(`quickTags.${tag.key}`)}
                                    </button>
                                ))}
                            </div>

                            {/* Customer-facing summary: keep it short and readable. The full
                                provider prompt remains in the editable field above and the
                                style details are available only through the advanced disclosure. */}
                            <div
                                data-testid="cast-generation-summary"
                                className="mt-3 rounded-md border border-glass-border bg-black/20 px-3.5 py-2.5"
                            >
                                <p className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-text-muted">
                                    {t("customerSummaryTitle")}
                                </p>
                                <div className="mt-1.5 space-y-1 text-[0.75rem] leading-relaxed">
                                    <p>
                                        <span className="text-text-muted">{t("customerSummaryComposition")}：</span>
                                        <span className="text-text-secondary">{compositionSummary}</span>
                                    </p>
                                    {applyStyle && styleDisplayName && (
                                        <p>
                                            <span className="text-text-muted">{t("customerSummaryStyle")}：</span>
                                            <span className="text-primary/80">{styleDisplayName}</span>
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Generation config — unified section */}
                            <div className="mt-5 pt-4 border-t border-glass-border space-y-4">
                                <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                    {t("generationConfig")}
                                </p>

                                {/* Batch — full row */}
                                <div>
                                    <label className="block font-mono text-[0.625rem] uppercase tracking-[0.16em] text-text-muted mb-2">
                                        {t("batchLabel")}
                                    </label>
                                    <div className="flex items-center gap-2">
                                        {[1, 2, 4].map((n) => (
                                            <button
                                                key={n}
                                                onClick={() => setBatchSize(n)}
                                                disabled={generating}
                                                className={`px-3 py-1.5 rounded-md border font-mono text-[0.75rem] transition-colors ${
                                                    batchSize === n
                                                        ? accent.batchActive
                                                        : "border-glass-border bg-glass text-text-muted hover:border-foreground/30 hover:text-text-secondary"
                                                } disabled:opacity-40`}
                                            >
                                                ×{n}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Ratio — full row */}
                                <div>
                                    <label className="block font-mono text-[0.625rem] uppercase tracking-[0.16em] text-text-muted mb-2">
                                        {t("aspectRatioLabel")}
                                    </label>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {["9:16", "3:4", "1:1", "4:3", "16:9"].map((ratio) => (
                                            <button
                                                key={ratio}
                                                onClick={() => setAspectRatioOverride(ratio === defaultAspectRatio ? null : ratio)}
                                                disabled={generating}
                                                className={`px-3 py-1.5 rounded-md border font-mono text-[0.75rem] transition-colors ${
                                                    effectiveAspectRatio === ratio
                                                        ? accent.batchActive
                                                        : "border-glass-border bg-glass text-text-muted hover:border-foreground/30 hover:text-text-secondary"
                                                } disabled:opacity-40`}
                                            >
                                                {ratio}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Model — full row, chip selected */}
                                <div>
                                    <label className="block font-mono text-[0.625rem] uppercase tracking-[0.16em] text-text-muted mb-2">
                                        {t("modelLabel")}
                                    </label>
                                    <GroupedModelGrid
                                        models={IMAGE_MODELS}
                                        selectedId={selectedModelId}
                                        onSelect={(id) => setModelOverride(id === selectedModelId ? null : id)}
                                    />
                                </div>
                            </div>

                            {/* Generate CTA */}
                            <button
                                onClick={handleGenerate}
                                disabled={generating || !prompt.trim()}
                                className="mt-5 self-center inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-md bg-primary text-white border border-[rgba(100,108,255,0.65)] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.14)] hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[0.875rem] font-semibold"
                            >
                                {generating ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                                {generating
                                    ? t("generating")
                                    : variants.length === 0
                                        ? t("generateFirst")
                                        : t("generateMore", { count: batchSize })}
                            </button>
                        </div>

                        {/* RIGHT — variants gallery */}
                        <div className="flex flex-col p-5 overflow-y-auto custom-scrollbar bg-surface">
                            <input ref={uploadInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={t("uploadReference")}
                                onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void handleUpload(file); }} />
                            <div className="flex gap-2 mb-3">
                                <button type="button" disabled={uploading} onClick={() => uploadInput.current?.click()}
                                    className="glass-button flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 disabled:opacity-50">
                                    {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    {t(uploading ? "uploading" : "uploadReference")}
                                </button>
                                <button
                                    type="button"
                                    disabled={generating || referenceLibraryAssets.length === 0}
                                    onClick={() => setLibraryPickerOpen((open) => !open)}
                                    className={`glass-button inline-flex items-center justify-center gap-2 px-3 py-2 disabled:opacity-50 ${libraryPickerOpen ? "border-primary/60 text-primary" : ""}`}
                                >
                                    <Library size={16} />
                                    {t("chooseFromLibrary")}
                                </button>
                            </div>
                            {selectedLibraryAsset && (
                                <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/35 bg-primary/5 p-2">
                                    <PreviewImage
                                        src={getAssetUrl(selectedLibraryAsset.variant.url)}
                                        alt={`${selectedLibraryAsset.asset.name} ${selectedLibraryAsset.variant.id}`}
                                        className="h-12 w-12 rounded object-cover"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[0.75rem] font-medium text-foreground truncate">{selectedLibraryAsset.asset.name}</p>
                                        <p className="text-[0.625rem] text-primary/80">{t("libraryReferenceSelected")}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleClearLibraryReference}
                                        aria-label={t("clearLibraryReference")}
                                        className="rounded p-1 text-text-muted hover:bg-hover-bg hover:text-foreground"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                            {libraryPickerOpen && (
                                <div data-testid="cast-library-reference-picker" className="mb-4 max-h-[38vh] overflow-y-auto rounded-lg border border-glass-border bg-surface-inset p-3 custom-scrollbar">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div>
                                            <p className="text-[0.75rem] font-medium text-foreground">{t("libraryReferenceTitle")}</p>
                                            <p className="mt-0.5 text-[0.625rem] text-text-muted">{t("libraryReferenceHint")}</p>
                                        </div>
                                        <button type="button" onClick={() => setLibraryPickerOpen(false)} aria-label={t("closeLibraryReferencePicker")} className="p-1 text-text-muted hover:text-foreground">
                                            <X size={13} />
                                        </button>
                                    </div>
                                    <div className="space-y-3">
                                        {referenceLibraryAssets.map((asset) => (
                                            <div key={`${asset.asset_type}:${asset.asset_id}`}>
                                                <div className="mb-1 flex items-center gap-1.5">
                                                    <p className="text-[0.6875rem] font-medium text-text-secondary truncate">{asset.name}</p>
                                                    {asset.source && <span className="text-[0.5625rem] text-text-muted">· {t(`librarySource.${asset.source}`)}</span>}
                                                </div>
                                                <div className="grid grid-cols-3 gap-1.5">
                                                    {asset.variants.map((variant) => {
                                                        const active = libraryReference?.asset_type === asset.asset_type
                                                            && libraryReference.asset_id === asset.asset_id
                                                            && libraryReference.variant_id === variant.id;
                                                        return (
                                                            <button
                                                                type="button"
                                                                key={variant.id}
                                                                aria-label={t("useLibraryVariant", { name: asset.name })}
                                                                onClick={() => handleChooseLibraryVariant(asset, variant)}
                                                                className={`relative overflow-hidden rounded border text-left ${active ? "border-primary ring-1 ring-primary/60" : "border-glass-border hover:border-foreground/40"}`}
                                                            >
                                                                <PreviewImage
                                                                    src={getAssetUrl(variant.url)}
                                                                    alt={`${asset.name} ${variant.id}`}
                                                                    className="h-20 w-full object-cover"
                                                                />
                                                                {active && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-white"><Check size={11} /></span>}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {/* Gallery header with filter tabs */}
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
                                    {t("variantsTitle")}
                                    <span className="text-text-muted/60"> ({variants.length})</span>
                                </h3>
                                {variants.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => setGalleryFilter("all")}
                                            className={`px-2.5 py-1 rounded text-[0.6875rem] transition-colors ${
                                                galleryFilter === "all"
                                                    ? "bg-elevated text-foreground"
                                                    : "text-text-muted hover:text-text-secondary"
                                            }`}
                                        >
                                            {t("filterAll")}
                                        </button>
                                        <button
                                            onClick={() => setGalleryFilter("favorited")}
                                            className={`px-2.5 py-1 rounded text-[0.6875rem] transition-colors inline-flex items-center gap-1 ${
                                                galleryFilter === "favorited"
                                                    ? "bg-amber-500/15 text-amber-300"
                                                    : "text-text-muted hover:text-text-secondary"
                                            }`}
                                        >
                                            <Star size={10} className={galleryFilter === "favorited" ? "fill-amber-300" : ""} />
                                            {t("filterFavorited")} ({variants.filter(v => v.is_favorited).length})
                                        </button>
                                    </div>
                                )}
                            </div>
                            {filteredVariants.length === 0 && variants.length === 0 ? (
                                <button type="button" disabled={uploading} onClick={() => uploadInput.current?.click()} className="flex-1 grid place-items-center text-center text-text-muted rounded-lg border border-dashed border-glass-border hover:bg-hover-bg focus-visible:ring-2 focus-visible:ring-primary">
                                    <div className="max-w-xs">
                                        <div className="mx-auto w-12 h-12 grid place-items-center rounded-full border border-glass-border bg-glass mb-3">
                                            <Sparkles size={18} />
                                        </div>
                                        <p className="text-[0.875rem] text-foreground">{t("emptyVariantsTitle")}</p>
                                        <p className="text-[0.75rem] text-text-secondary mt-1">{t("emptyVariantsBody")}</p>
                                    </div>
                                </button>
                            ) : filteredVariants.length === 0 ? (
                                <div className="flex-1 grid place-items-center text-center text-text-muted">
                                    <p className="text-[0.75rem]">{t("noFavoritedYet")}</p>
                                </div>
                            ) : (
                                <div className="columns-2 lg:columns-3 gap-3 space-y-3">
                                    {filteredVariants.map((v) => {
                                        const isSelected = v.id === selectedId;
                                        return (
                                            <div
                                                key={v.id}
                                                className={`relative rounded-lg overflow-hidden border-2 transition-all break-inside-avoid group ${
                                                    isSelected
                                                        ? accent.variantSelected
                                                        : "border-glass-border hover:border-foreground/30"
                                                }`}
                                            >
                                                <div className="cursor-pointer" onClick={() => !isSelected && handleSelectVariant(v.id)}>
                                                    <PreviewImage
                                                        src={getAssetUrl(v.url)}
                                                        alt={`${entity.name} ${v.id}`}
                                                        className="w-full h-auto max-h-[280px] object-contain"
                                                    />
                                                </div>
                                                {/* Favorite star */}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(v.id, !!v.is_favorited); }}
                                                    aria-label={v.is_favorited ? t("unfavoriteVariant") : t("favoriteVariant")}
                                                    className={`absolute top-1.5 left-1.5 p-1 rounded-full transition-all ${
                                                        v.is_favorited
                                                            ? "bg-amber-500/30 text-amber-300"
                                                            : "bg-black/40 text-text-secondary opacity-0 group-hover:opacity-100"
                                                    }`}
                                                >
                                                    <Star size={12} className={v.is_favorited ? "fill-amber-300" : ""} />
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={deletingVariantId !== null}
                                                    onClick={(e) => { e.stopPropagation(); void handleDeleteVariant(v.id); }}
                                                    aria-label={t("deleteVariant")}
                                                    title={t("deleteVariant")}
                                                    className="absolute bottom-[68px] right-1.5 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white/80 transition-colors hover:bg-red-500/80 hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                                >
                                                    {deletingVariantId === v.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                                </button>
                                                {kind === "character" && (
                                                    <button
                                                        type="button"
                                                        disabled={uploading}
                                                        onClick={(e) => { e.stopPropagation(); setEditingVariant(v); }}
                                                        aria-label={t("editVariant")}
                                                        title={t("editVariant")}
                                                        className="absolute bottom-[68px] right-12 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white/80 transition-colors hover:bg-primary/80 hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                )}
                                                {/* Selected badge */}
                                                {isSelected && (
                                                    <div className={`absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-foreground shadow-md ${accent.selectBadge}`}>
                                                        <Check size={12} strokeWidth={2.6} />
                                                    </div>
                                                )}
                                                {/* Select hint on hover */}
                                                {!isSelected && (
                                                    <div
                                                        onClick={() => handleSelectVariant(v.id)}
                                                        className="absolute inset-x-0 bottom-[60px] bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer pt-6 pb-1.5"
                                                    >
                                                        <p className="w-full text-center text-[0.625rem] uppercase tracking-[0.16em] text-foreground font-mono">
                                                            {t("clickToSelect")}
                                                        </p>
                                                    </div>
                                                )}
                                                <div className="grid grid-cols-2 gap-1.5 border-t border-glass-border bg-surface-inset p-1.5" onClick={(event) => event.stopPropagation()}>
                                                    <select
                                                        aria-label={t("viewRoleFor", { name: entity.name })}
                                                        value={v.reference_view_role ?? ""}
                                                        onChange={(event) => void handleUpdateViewMetadata(v, { reference_view_role: event.target.value })}
                                                        className="min-w-0 rounded border border-glass-border bg-surface px-1.5 py-1 text-[0.6875rem] text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                                    >
                                                        <option value="">{t("viewRole")}</option>
                                                        {(["front", "left", "right", "back", "three_quarter_left", "three_quarter_right", "top", "bottom", "detail"] as const).map((value) => (
                                                            <option key={value} value={value}>{t(`viewRoleOptions.${value}`)}</option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        aria-label={t("viewDistanceFor", { name: entity.name })}
                                                        value={v.reference_distance ?? ""}
                                                        onChange={(event) => void handleUpdateViewMetadata(v, { reference_distance: event.target.value })}
                                                        className="min-w-0 rounded border border-glass-border bg-surface px-1.5 py-1 text-[0.6875rem] text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                                                    >
                                                        <option value="">{t("viewDistance")}</option>
                                                        {(["full", "medium", "close", "macro"] as const).map((value) => (
                                                            <option key={value} value={value}>{t(`viewDistanceOptions.${value}`)}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {/* Gallery bottom operations — always visible */}
                            {variants.length > 0 && (
                                <div className="mt-auto pt-4 border-t border-glass-border flex items-center gap-2 flex-wrap">
                                    <span className="text-[0.6875rem] text-text-muted mr-auto">
                                        {variants.filter(v => v.is_favorited).length > 0
                                            ? t("favoritedCount", { count: variants.filter(v => v.is_favorited).length })
                                            : t("favoritedHint")}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer — status only, no action button (state auto-saves) */}
                    <footer className="flex items-center px-5 py-2.5 border-t border-glass-border">
                        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-text-muted">
                            {selectedId ? t("selectedFooter") : t("noneSelectedFooter")}
                        </span>
                    </footer>
                </motion.div>
            </motion.div>
            {editingVariant && kind === "character" && (
                <ImageEditor
                    source={api.assetVariantContentUrl(currentProject.id, "character", entity!.id, editingVariant.id)}
                    title={`${entity?.name ?? "Character"} · ${t("editVariant")}`}
                    onClose={() => setEditingVariant(null)}
                    onSave={handleSaveEditedVariant}
                />
            )}
        </AnimatePresence>
    ), document.body);
}
