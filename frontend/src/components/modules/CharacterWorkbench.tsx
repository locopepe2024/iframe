"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Check, Image as ImageIcon, Lock, ChevronRight, Pencil, Video, Upload, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { api, type AssetLibraryReference, type AssetReferenceIndexEntry } from "@/lib/api";

import { VariantSelector } from "../common/VariantSelector";
import { VideoVariantSelector } from "../common/VideoVariantSelector";
import { useProjectStore } from "@/store/projectStore";
import { Image as PhotoIcon } from "lucide-react";
import { getAssetUrl } from "@/lib/utils";
import { toast } from "@/store/toastStore";
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

const ImageEditor = dynamic(() => import("@/components/shared/image-editor/ImageEditor"), { ssr: false });

type CharacterEditUploadType = "reference_sheet" | "full_body" | "three_views" | "head_shot";

interface CharacterEditTarget {
    source: string;
    title: string;
    uploadType: CharacterEditUploadType;
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

function selectedVariant(unit: any): any | undefined {
    const variants = Array.isArray(unit?.variants)
        ? unit.variants
        : Array.isArray(unit?.image_variants)
            ? unit.image_variants
            : [];
    const selectedId = unit?.selected_id || unit?.selected_image_id;
    return variants.find((variant: any) => variant?.id === selectedId) || variants.at(-1);
}

function selectedReferenceSheetUrl(referenceSheet: any): string | undefined {
    const variants = Array.isArray(referenceSheet?.image_variants) ? referenceSheet.image_variants : [];
    if (variants.length === 0) return undefined;
    const selectedId = referenceSheet?.selected_image_id;
    if (selectedId) return variants.find((variant: any) => variant?.id === selectedId)?.url;
    return variants[0]?.url;
}


interface CharacterWorkbenchProps {
    asset: any;
    onClose: () => void;
    onUpdateDescription: (desc: string) => void;
    onGenerate: (type: string, prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number, references?: AssetLibraryReference[], imageGenerationMode?: "text" | "reference") => void;
    generatingTypes: { type: string; batchSize: number }[];
    stylePrompt?: string;
    styleNegativePrompt?: string;
    onGenerateVideo?: (prompt: string, duration: number, subType?: string) => void;
    onDeleteVideo?: (videoId: string) => void;
    isGeneratingVideo?: boolean;
}

export default function CharacterWorkbench({ asset, onClose, onUpdateDescription, onGenerate, generatingTypes = [], stylePrompt = "", styleNegativePrompt = "", onGenerateVideo, onDeleteVideo, isGeneratingVideo }: CharacterWorkbenchProps) {
    const tc = useTranslations("character");
    const ti = useTranslations("imageEditor");
    const [activePanel, setActivePanel] = useState<"full_body" | "three_view" | "headshot" | "video">("full_body");
    const updateProject = useProjectStore(state => state.updateProject);
    const currentProject = useProjectStore(state => state.currentProject);
    const [editTarget, setEditTarget] = useState<CharacterEditTarget | null>(null);
    const [assetIndex, setAssetIndex] = useState<AssetReferenceIndexEntry[]>([]);
    const selectionQueue = useRef<Promise<void>>(Promise.resolve());
    const selectionVersion = useRef(0);
    const [promptReferences, setPromptReferences] = useState<Record<"full_body" | "three_view" | "headshot", AssetLibraryReference[]>>({
        full_body: [],
        three_view: [],
        headshot: [],
    });
    const [promptModes, setPromptModes] = useState<Record<"full_body" | "three_view" | "headshot", "text" | "reference">>({
        full_body: "text",
        three_view: "text",
        headshot: "text",
    });

    useEffect(() => {
        const projectId = currentProject?.id;
        if (!projectId || typeof api.getAssetReferenceIndex !== "function") {
            setAssetIndex([]);
            return;
        }
        let active = true;
        void api.getAssetReferenceIndex(projectId)
            .then((index) => {
                if (active) setAssetIndex(index.assets.filter((entry) => entry.variants?.some((variant) => variant.id)));
            })
            .catch(() => {
                if (active) setAssetIndex([]);
            });
        return () => { active = false; };
    }, [currentProject?.id, currentProject?.characters, currentProject?.scenes, currentProject?.props]);

    useEffect(() => {
        setPromptReferences({ full_body: [], three_view: [], headshot: [] });
        setPromptModes({ full_body: "text", three_view: "text", headshot: "text" });
    }, [asset.id]);

    const referenceCandidates = useMemo<ReferenceCandidate[]>(() => {
        const usedLabels = new Set<string>();
        const candidates: ReferenceCandidate[] = [];
        for (const entry of assetIndex) {
            const variants = entry.variants || [];
            variants.forEach((variant, index) => {
                if (!variant.id) return;
                const variantLabel = variant.reference_view_role || variant.reference_distance || `View ${index + 1}`;
                const baseLabel = variants.length > 1 ? `${entry.name} · ${variantLabel}` : entry.name;
                let label = baseLabel;
                let suffix = 2;
                while (usedLabels.has(label)) label = `${baseLabel} ${suffix++}`;
                usedLabels.add(label);
                candidates.push({
                    label,
                    previewUrl: getAssetUrl(variant.url),
                    sourceLabel: entry.source_name || entry.source_scope,
                    variantLabel,
                    reference: { asset_type: entry.asset_type, asset_id: entry.asset_id, variant_id: variant.id },
                });
            });
        }
        return candidates;
    }, [assetIndex]);

    const openVariantEditor = (unit: any, fallback: string | undefined, panelTitle: string, uploadType: CharacterEditUploadType) => {
        const variant = selectedVariant(unit);
        const source = currentProject && variant?.id
            ? api.assetVariantContentUrl(currentProject.id, "character", asset.id, variant.id)
            : getAssetUrl(fallback || variant?.url);
        if (!source) return;
        setEditTarget({ source, title: `${asset.name} · ${panelTitle}`, uploadType });
    };

    // Uploads are immediately usable in the same explicit @ index. The
    // project asset index is fetched once per workbench session, so merge the
    // newly created selected variant locally instead of requiring a reload.
    const retainUploadedVariantInIndex = (updatedProject: any, uploadType: CharacterEditUploadType) => {
        const updatedAsset = updatedProject?.characters?.find((item: any) => item.id === asset.id);
        const unit = uploadType === "reference_sheet"
            ? updatedAsset?.reference_sheet
            : uploadType === "full_body"
                ? updatedAsset?.full_body_asset
                : uploadType === "three_views"
                ? updatedAsset?.three_view_asset
                : updatedAsset?.headshot_asset;
        const variant = selectedVariant(unit);
        if (!variant?.id) return;
        setAssetIndex((current) => {
            const existing = current.find((entry) => entry.asset_type === "character" && entry.asset_id === asset.id);
            if (!existing) {
                return [...current, {
                    asset_type: "character",
                    asset_id: asset.id,
                    name: updatedAsset?.name || asset.name,
                    source_scope: "episode",
                    source_container_id: currentProject?.id || null,
                    selected_variant_id: variant.id,
                    variants: [{ id: variant.id, url: variant.url, is_favorited: variant.is_favorited, reference_view_role: variant.reference_view_role, reference_distance: variant.reference_distance }],
                }];
            }
            if (existing.variants.some((item) => item.id === variant.id)) return current;
            return current.map((entry) => entry === existing
                ? {
                    ...entry,
                    selected_variant_id: variant.id,
                    variants: [...entry.variants, { id: variant.id, url: variant.url, is_favorited: variant.is_favorited, reference_view_role: variant.reference_view_role, reference_distance: variant.reference_distance }],
                }
                : entry);
        });
    };

    const uploadCharacterImage = async (file: File, uploadType: CharacterEditUploadType) => {
        if (!currentProject) throw new Error("Project is no longer available");
        const updatedProject = await api.uploadAsset(
            currentProject.id,
            "character",
            asset.id,
            file,
            uploadType,
            asset.description,
        );
        updateProject(currentProject.id, updatedProject);
        retainUploadedVariantInIndex(updatedProject, uploadType);
        toast.success(tc("uploadRef"));
    };

    const saveEditedImage = async (file: File) => {
        if (!currentProject || !editTarget) throw new Error("Project is no longer available");
        const updatedProject = await api.uploadAsset(
            currentProject.id,
            "character",
            asset.id,
            file,
            editTarget.uploadType,
            asset.description,
        );
        updateProject(currentProject.id, updatedProject);
        retainUploadedVariantInIndex(updatedProject, editTarget.uploadType);
        toast.success(ti("saved"));
        setEditTarget(null);
    };

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
    const masterImageUploadType: CharacterEditUploadType = referenceSheetImageAsset ? "reference_sheet" : "full_body";
    const hasFullBodyImage = !!masterImageUrl;

    // Local state for prompts
    const getInitialPrompt = (type: string, existingPrompt: string) => {
        if (existingPrompt) return existingPrompt;

        if (type === "full_body") {
            return buildCharacterImagePrompt("full_body", asset.name, asset.description, hasNonFullBodyUpload);
        }
        if (type === "three_view") {
            return buildCharacterImagePrompt("three_view", asset.name, asset.description, hasFullBodyImage || hasAnyUpload);
        }
        if (type === "headshot") {
            return buildCharacterImagePrompt("headshot", asset.name, asset.description, hasFullBodyImage || hasAnyUpload);
        }
        return "";
    };

    const [fullBodyPrompt, setFullBodyPrompt] = useState(getInitialPrompt("full_body", asset.full_body_prompt));
    const [threeViewPrompt, setThreeViewPrompt] = useState(getInitialPrompt("three_view", asset.three_view_prompt));
    const [headshotPrompt, setHeadshotPrompt] = useState(getInitialPrompt("headshot", asset.headshot_prompt));
    const [videoPrompt, setVideoPrompt] = useState(asset.video_prompt || "");

    // New State for Style Control
    const [applyStyle, setApplyStyle] = useState(true);
    // User's own negative prompt (initially empty or with sensible defaults)
    const [negativePrompt, setNegativePrompt] = useState(DEFAULT_CHARACTER_NEGATIVE_PROMPT);
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
        if (asset.full_body_prompt) setFullBodyPrompt(asset.full_body_prompt);
        else if (hasNonFullBodyUpload && !hasCharacterReferenceConstraint(fullBodyPrompt)) {
            setFullBodyPrompt(getInitialPrompt("full_body", ""));
        }

        if (asset.three_view_prompt) setThreeViewPrompt(asset.three_view_prompt);
        else if (hasAnyUpload && !hasCharacterReferenceConstraint(threeViewPrompt)) {
            setThreeViewPrompt(getInitialPrompt("three_view", ""));
        }

        if (asset.headshot_prompt) setHeadshotPrompt(asset.headshot_prompt);
        else if (hasAnyUpload && !hasCharacterReferenceConstraint(headshotPrompt)) {
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
        const references = promptReferences[promptType];
        const imageGenerationMode = promptModes[promptType];
        if (imageGenerationMode === "reference" && references.length === 0) {
            toast.warning("Add at least one explicit @ reference before generating.");
            return;
        }
        if (imageGenerationMode === "text" && references.length > 0) {
            toast.warning("This prompt contains @ references. Select Reference image mode before generating.");
            return;
        }
        onGenerate(type, prompt, applyStyle, negativePrompt, batchSize, references, imageGenerationMode);
    };

    const setPanelReferences = (type: "full_body" | "three_view" | "headshot", references: AssetLibraryReference[]) => {
        setPromptReferences((current) => ({ ...current, [type]: references }));
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

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-md p-4 md:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface border border-glass-border rounded-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden shadow-lg"
            >
                <div className="h-16 border-b border-glass-border flex justify-between items-center px-6 bg-surface">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-bold text-foreground">{asset.name} <span className="text-text-muted font-normal text-sm ml-2">{tc("workbench")}</span></h2>
                        <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full">
                            <span className="text-xs text-blue-400 font-medium">{tc("tipConsistency")}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-hover-bg rounded-full text-text-secondary hover:text-foreground transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Main Content - 3 Columns */}
                <div className="flex-1 flex overflow-hidden">

                    {/* Panel 1: Full Body (Master) */}
                    <WorkbenchPanel
                        assetScope={asset.id}
                        title={tc("masterAsset")}
                        isActive={activePanel === "full_body"}
                        onClick={() => setActivePanel("full_body")}

                        asset={masterAsset}
                        currentImageUrl={masterImageUrl}
                        editImageUrl={masterImageUrl}
                        onEditImage={() => openVariantEditor(masterAsset, masterImageUrl, tc("masterAsset"), masterImageUploadType)}
                        onUploadImage={(file: File) => uploadCharacterImage(file, masterImageUploadType)}
                        onSelect={(id: string) => handleSelectVariant(masterGenerationType, id)}
                        onDelete={(id: string) => handleDeleteVariant(masterGenerationType, id)}
                        onFavorite={(id: string, isFav: boolean) => handleFavoriteVariant(masterGenerationType, id, isFav)}

                        prompt={fullBodyPrompt}
                        setPrompt={setFullBodyPrompt}
                        referenceCandidates={referenceCandidates}
                        onReferencesChange={(references: AssetLibraryReference[]) => setPanelReferences("full_body", references)}
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
                    />


                    {/* Divider */}
                    <div className="w-px bg-glass flex items-center justify-center">
                        <ChevronRight size={16} className="text-text-muted" />
                    </div>

                    {/* Panel 2: Three View (Derived) */}
                    <WorkbenchPanel
                        assetScope={asset.id}
                        title={tc("threeViews")}
                        isActive={activePanel === "three_view"}
                        onClick={() => setActivePanel("three_view")}

                        asset={asset.three_view_asset}
                        currentImageUrl={asset.three_view_image_url}
                        editImageUrl={selectedVariantUrl(asset.three_view_asset, asset.three_view_image_url)}
                        onEditImage={() => openVariantEditor(asset.three_view_asset, asset.three_view_image_url, tc("threeViews"), "three_views")}
                        onUploadImage={(file: File) => uploadCharacterImage(file, "three_views")}
                        onSelect={(id: string) => handleSelectVariant("three_view", id)}
                        onDelete={(id: string) => handleDeleteVariant("three_view", id)}
                        onFavorite={(id: string, isFav: boolean) => handleFavoriteVariant("three_view", id, isFav)}

                        prompt={threeViewPrompt}
                        setPrompt={setThreeViewPrompt}
                        referenceCandidates={referenceCandidates}
                        onReferencesChange={(references: AssetLibraryReference[]) => setPanelReferences("three_view", references)}
                        imageGenerationMode={promptModes.three_view}
                        onImageGenerationModeChange={(mode: "text" | "reference") => setPanelMode("three_view", mode)}
                        onGenerate={(batchSize: number) => handleGenerateClick("three_view", batchSize)}
                        isGenerating={getGeneratingInfo("three_view").isGenerating}
                        generatingBatchSize={getGeneratingInfo("three_view").batchSize}
                        isLocked={!hasFullBodyImage && !hasAnyUpload}
                        description="Front, side, and back views for 3D-like consistency."
                        aspectRatio="16:9"
                    />

                    {/* Divider */}
                    <div className="w-px bg-glass flex items-center justify-center">
                        <ChevronRight size={16} className="text-text-muted" />
                    </div>

                    {/* Panel 3: Headshot (Derived) */}
                    <WorkbenchPanel
                        assetScope={asset.id}
                        title={tc("avatar")}
                        isActive={activePanel === "headshot"}
                        onClick={() => setActivePanel("headshot")}

                        asset={asset.headshot_asset}
                        currentImageUrl={asset.headshot_image_url || asset.avatar_url}
                        editImageUrl={selectedVariantUrl(asset.headshot_asset, asset.headshot_image_url || asset.avatar_url)}
                        onEditImage={() => openVariantEditor(asset.headshot_asset, asset.headshot_image_url || asset.avatar_url, tc("avatar"), "head_shot")}
                        onUploadImage={(file: File) => uploadCharacterImage(file, "head_shot")}
                        onSelect={(id: string) => handleSelectVariant("headshot", id)}
                        onDelete={(id: string) => handleDeleteVariant("headshot", id)}
                        onFavorite={(id: string, isFav: boolean) => handleFavoriteVariant("headshot", id, isFav)}

                        prompt={headshotPrompt}
                        setPrompt={setHeadshotPrompt}
                        referenceCandidates={referenceCandidates}
                        onReferencesChange={(references: AssetLibraryReference[]) => setPanelReferences("headshot", references)}
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
                    />


                </div>

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

                        {/* Apply Style Toggle */}
                        <div className="pt-6">
                            <div className="flex items-center gap-2 bg-surface px-4 py-2 rounded-lg border border-glass-border">
                                <input
                                    type="checkbox"
                                    id="applyStyleFooter"
                                    checked={applyStyle}
                                    onChange={(e) => setApplyStyle(e.target.checked)}
                                    className="rounded border-gray-600 bg-gray-700 text-primary focus:ring-primary w-4 h-4"
                                />
                                <label htmlFor="applyStyleFooter" className="text-xs font-bold text-text-secondary cursor-pointer select-none whitespace-nowrap">
                                    {tc("workbench")}
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Art Direction Style Display (Collapsible) - Only show toggle when style exists */}
                    {applyStyle && (stylePrompt || styleNegativePrompt) && (
                        <div className="border-t border-border-subtle">
                            <button
                                onClick={() => setShowStyleExpanded(!showStyleExpanded)}
                                className="w-full px-6 py-2 flex items-center justify-between hover:bg-glass transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500" />
                                    <span className="text-xs font-bold text-text-secondary uppercase">Art Direction Style (Will Be Appended)</span>
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
            </motion.div>
            {editTarget && (
                <ImageEditor
                    source={editTarget.source}
                    title={editTarget.title}
                    onClose={() => setEditTarget(null)}
                    onSave={saveEditedImage}
                />
            )}
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
    editImageUrl,
    onEditImage,
    onUploadImage,
    onSelect,
    onDelete,
    onFavorite,

    prompt,
    setPrompt,
    referenceCandidates = [],
    onReferencesChange,
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
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [mention, setMention] = useState<ReferenceSuggestion | null>(null);
    const matchingReferenceCandidates = referenceCandidates.filter((candidate: ReferenceCandidate) =>
        candidate.label.toLocaleLowerCase().includes(mention?.query.toLocaleLowerCase() ?? ""),
    );

    return (
        <div
            className={`flex-1 flex flex-col min-w-[300px] transition-colors ${isActive ? 'bg-glass' : 'bg-transparent hover:bg-hover-bg'}`}
            onClick={onClick}
        >
            {/* Panel Header */}
            <div className="p-4 border-b border-border-subtle">
                <div className="flex items-center justify-between mb-1">
                    <h3 className={`font-bold text-sm uppercase tracking-wider ${isActive ? 'text-primary' : 'text-text-secondary'}`}>
                        {title}
                    </h3>

                    {mode === 'static' && (
                        <div className="flex items-center gap-1">
                            {onUploadImage && (
                                <label
                                    className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-glass-border px-2 text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground focus-within:outline focus-within:outline-2 focus-within:outline-primary"
                                    title={tc("uploadRef")}
                                >
                                    <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        className="sr-only"
                                        aria-label={`${tc("uploadRef")}: ${title}`}
                                        disabled={isUploadingImage}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={async (event) => {
                                            event.stopPropagation();
                                            const file = event.target.files?.[0];
                                            event.target.value = "";
                                            if (!file) return;
                                            setIsUploadingImage(true);
                                            try { await onUploadImage(file); }
                                            finally { setIsUploadingImage(false); }
                                        }}
                                    />
                                    {isUploadingImage ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    <span className="hidden text-xs sm:inline">{tc("uploadRef")}</span>
                                </label>
                            )}
                            {onEditImage && editImageUrl && (
                                <button
                                    type="button"
                                    onClick={(event) => { event.stopPropagation(); onEditImage(); }}
                                    className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-glass-border px-2 text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                                    title={ti("title")}
                                    aria-label={`${ti("title")}: ${title}`}
                                >
                                    <Pencil size={16} />
                                    <span className="hidden text-xs sm:inline">{ti("title")}</span>
                                </button>
                            )}
                        </div>
                    )}

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
                                <img
                                    src={typeof reverseReferenceUrl === 'string' && reverseReferenceUrl.startsWith('http')
                                        ? reverseReferenceUrl
                                        : `${window.location.origin}/${reverseReferenceUrl}`}
                                    alt="Reference"
                                    className="w-16 h-16 rounded-lg object-cover border border-glass-border"
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
                                    <video
                                        key={motionRefVideos[motionRefVideos.length - 1]?.url}
                                        src={getAssetUrl(motionRefVideos[motionRefVideos.length - 1]?.url)}
                                        onCanPlay={() => setIsVideoLoading(false)}
                                        onLoadStart={() => setIsVideoLoading(true)}
                                        className="w-full h-full object-contain"
                                        controls
                                        loop
                                        autoPlay
                                        muted
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
                            currentImageUrl={currentImageUrl}
                            onSelect={onSelect}
                            onDelete={onDelete}
                            onFavorite={onFavorite}
                            onGenerate={onGenerate}
                            isGenerating={isGenerating}
                            generatingBatchSize={generatingBatchSize}
                            aspectRatio={aspectRatio}
                            className="h-full"
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
            <div className="h-1/3 border-t border-glass-border flex flex-col bg-surface">
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
                <div className="relative min-h-0 flex-1 overflow-visible p-4">
                    <ReferencePromptEditor
                        value={prompt}
                        candidates={referenceCandidates}
                        onChange={setPrompt}
                        onReferencesChange={onReferencesChange}
                        onMentionChange={setMention}
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
                                        {candidate.previewUrl ? (
                                            <img src={candidate.previewUrl} alt="" className="h-full w-full object-cover" />
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
