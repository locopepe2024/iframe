"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Check, AlertTriangle, Image as ImageIcon, Lock, Unlock, ChevronRight, Maximize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { api, API_URL } from "@/lib/api";
import { VariantSelector } from "../common/VariantSelector";
import { useProjectStore } from "@/store/projectStore";
import { resolveNegativePrompt, resolveStylePrompt } from "./storyboard-r2v/buildAssembledPrompt";

interface StoryboardFrameEditorProps {
    frame: any;
    onClose: () => void;
}

export default function StoryboardFrameEditor({ frame: initialFrame, onClose }: StoryboardFrameEditorProps) {
    const ts = useTranslations("storyboard");
    const currentProject = useProjectStore(state => state.currentProject);
    const updateProject = useProjectStore(state => state.updateProject);
    const selectionQueue = useRef<Promise<void>>(Promise.resolve());
    const selectionVersion = useRef(0);

    // Get the latest frame data from the store (instead of using stale prop)
    const frame = useMemo(() => {
        if (!currentProject?.frames) return initialFrame;
        return currentProject.frames.find((f: any) => f.id === initialFrame.id) || initialFrame;
    }, [currentProject?.frames, initialFrame.id, initialFrame]);

    const [prompt, setPrompt] = useState(frame.image_prompt || frame.action_description || "");
    const [stylePromptOverride, setStylePromptOverride] = useState(frame.style_prompt_override || "");
    const [lightingOverride, setLightingOverride] = useState(frame.lighting_override || "");
    const [negativePromptOverride, setNegativePromptOverride] = useState(frame.negative_prompt_override || "");
    const [isGenerating, setIsGenerating] = useState(false);

    // Sync prompt when frame changes
    useEffect(() => {
        setPrompt(frame.image_prompt || frame.action_description || "");
        setStylePromptOverride(frame.style_prompt_override || "");
        setLightingOverride(frame.lighting_override || "");
        setNegativePromptOverride(frame.negative_prompt_override || "");
    }, [
        frame.id,
        frame.image_prompt,
        frame.action_description,
        frame.style_prompt_override,
        frame.lighting_override,
        frame.negative_prompt_override,
    ]);

    const saveFrameStyleField = async (field: "style_prompt_override" | "lighting_override" | "negative_prompt_override", value: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.updateFrame(currentProject.id, frame.id, { [field]: value });
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to save frame style override:", error);
        }
    };

    const handleGenerate = async (batchSize: number) => {
        if (!currentProject) return;

        setIsGenerating(true);
        try {
            // Construct composition data (simplified for now, ideally passed from parent or re-calculated)
            // For re-rendering, we might want to reuse existing composition data or just rely on prompt/I2I
            // The api.renderFrame expects compositionData.
            // If we don't pass it, pipeline uses existing.

            const globalStylePrompt = currentProject.art_direction?.style_config?.positive_prompt || "";
            const globalNegativePrompt = currentProject.art_direction?.style_config?.negative_prompt || "";
            const effectivePrompt = [
                resolveStylePrompt(globalStylePrompt, stylePromptOverride, lightingOverride),
                prompt,
            ].filter(Boolean).join(" . ");
            const updatedProject = await api.renderFrame(
                currentProject.id,
                frame.id,
                null, // Use existing composition data
                effectivePrompt,
                batchSize,
                resolveNegativePrompt(globalNegativePrompt, "", negativePromptOverride),
            );
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to generate frame:", error);
            alert(ts("generateFailed"));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSelectVariant = (variantId: string) => {
        if (!currentProject) return;
        const version = ++selectionVersion.current;
        const operation = selectionQueue.current.then(async () => {
            const updatedProject = await api.selectAssetVariant(currentProject.id, frame.id, "storyboard_frame", variantId);
            if (version === selectionVersion.current) updateProject(currentProject.id, updatedProject);
        });
        selectionQueue.current = operation.catch(() => {});
        return operation.catch((error) => {
            console.error("Failed to select variant:", error);
            throw error;
        });
    };

    const handleDeleteVariant = async (variantId: string) => {
        if (!currentProject) return;
        try {
            await selectionQueue.current;
            const updatedProject = await api.deleteAssetVariant(currentProject.id, frame.id, "storyboard_frame", variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete variant:", error);
            throw error;
        }
    };

    const handleSavePrompt = async () => {
        if (!currentProject) return;
        // We can update the prompt without generating
        // But currently we don't have a specific endpoint for just updating frame prompt without render?
        // We can use updateAssetAttributes?
        // But frame is not exactly an asset in the same way.
        // Let's assume prompt is saved on generation for now.
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-md p-4 md:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-elevated border border-glass-border rounded-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden shadow-lg"
            >
                {/* Header */}
                <div className="h-16 border-b border-glass-border flex justify-between items-center px-6 bg-surface">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-bold text-foreground">{ts("frameEditor")} <span className="text-text-muted font-normal text-sm ml-2">#{frame.id.substring(0, 8)}</span></h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-hover-bg rounded-full text-text-secondary hover:text-foreground transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Left: Variant Selector */}
                    <div className="flex-1 bg-surface p-4 flex flex-col overflow-hidden relative">
                        <VariantSelector
                            key={frame.id}
                            asset={frame.rendered_image_asset}
                            currentImageUrl={frame.rendered_image_url || frame.image_url}
                            onSelect={handleSelectVariant}
                            onDelete={handleDeleteVariant}
                            onGenerate={handleGenerate}
                            isGenerating={isGenerating}
                            aspectRatio="16:9"
                            className="h-full"
                        />
                    </div>

                    {/* Right: Controls & Prompt */}
                    <div className="w-1/3 min-w-[350px] border-l border-glass-border bg-elevated flex flex-col">
                        <div className="p-4 border-b border-border-subtle">
                            <h3 className="font-bold text-sm uppercase tracking-wider text-text-secondary mb-2">
                                {ts("sceneContext")}
                            </h3>
                            <p className="text-xs text-text-secondary mb-2">
                                <span className="font-bold text-text-muted">{ts("action")}:</span> {frame.action_description}
                            </p>
                            {frame.dialogue && (
                                <p className="text-xs text-text-secondary italic">
                                    <span className="font-bold text-text-muted not-italic">{ts("dialogue")}:</span> "{frame.dialogue}"
                                </p>
                            )}
                        </div>

                        <div className="flex-1 p-4 flex flex-col">
                            <h3 className="font-bold text-sm uppercase tracking-wider text-text-secondary mb-2">
                                {ts("generationPrompt")}
                            </h3>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                className="flex-1 w-full bg-surface border border-glass-border rounded-lg p-4 text-sm text-text-secondary resize-none focus:outline-none focus:border-primary/50 font-mono leading-relaxed"
                                placeholder={ts("promptPlaceholder")}
                            />
                            <p className="text-xs text-text-muted mt-2">
                                {ts("promptHint")}
                            </p>
                            <div className="mt-4 space-y-3 border-t border-border-subtle pt-4">
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-text-secondary">{ts("shotStyleOverride")}</label>
                                    <textarea
                                        value={stylePromptOverride}
                                        onChange={(event) => setStylePromptOverride(event.target.value)}
                                        onBlur={(event) => saveFrameStyleField("style_prompt_override", event.target.value)}
                                        placeholder={currentProject?.art_direction?.style_config?.positive_prompt || ts("shotStylePlaceholder")}
                                        rows={2}
                                        className="w-full resize-y rounded-lg border border-glass-border bg-surface p-2.5 text-xs text-text-secondary focus:border-primary/50 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-text-secondary">{ts("shotLightingOverride")}</label>
                                    <textarea
                                        value={lightingOverride}
                                        onChange={(event) => setLightingOverride(event.target.value)}
                                        onBlur={(event) => saveFrameStyleField("lighting_override", event.target.value)}
                                        placeholder={ts("shotLightingPlaceholder")}
                                        rows={2}
                                        className="w-full resize-y rounded-lg border border-glass-border bg-surface p-2.5 text-xs text-text-secondary focus:border-primary/50 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-text-secondary">{ts("shotNegativeOverride")}</label>
                                    <textarea
                                        value={negativePromptOverride}
                                        onChange={(event) => setNegativePromptOverride(event.target.value)}
                                        onBlur={(event) => saveFrameStyleField("negative_prompt_override", event.target.value)}
                                        placeholder={ts("shotNegativePlaceholder")}
                                        rows={2}
                                        className="w-full resize-y rounded-lg border border-glass-border bg-surface p-2.5 text-xs text-text-secondary focus:border-primary/50 focus:outline-none"
                                    />
                                </div>
                                <p className="text-[0.6875rem] leading-relaxed text-text-muted">{ts("shotStyleHelper")}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
