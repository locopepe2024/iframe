"use client";

import { useProjectStore } from "@/store/projectStore";
import { api, type AssetLibraryReference } from "@/lib/api";
import { resolveAssetGenerationModel } from "@/lib/modelCatalog";
import { toast } from "@/store/toastStore";
import CharacterWorkbench from "@/components/modules/CharacterWorkbench";

/**
 * Cast entry adapter. The character UI and prompt contract remain canonical
 * in CharacterWorkbench; this component only supplies the Cast workflow's
 * project callbacks.
 */
export default function CharacterWorkbenchBridge({ entityId, onClose, seriesId }: { entityId: string; onClose: () => void; seriesId?: string | null }) {
    const project = useProjectStore((state) => state.currentProject);
    const series = useProjectStore((state) => state.currentSeries);
    const setCurrentSeries = useProjectStore((state) => state.setCurrentSeries);
    const updateProject = useProjectStore((state) => state.updateProject);
    const addGeneratingTask = useProjectStore((state) => state.addGeneratingTask);
    const removeGeneratingTask = useProjectStore((state) => state.removeGeneratingTask);
    const character = project?.characters?.find((item: any) => item.id === entityId)
        ?? series?.characters?.find((item: any) => item.id === entityId);
    const isSeriesCharacter = Boolean(seriesId && series?.characters?.some((item: any) => item.id === entityId));

    const style = project?.art_direction?.style_config;
    const stylePrompt = style?.positive_prompt || "";
    const styleNegativePrompt = style?.negative_prompt || "";

    const onGenerate = async (
        type: string,
        prompt: string,
        _applyStyle: boolean,
        negativePrompt: string,
        batchSize: number,
        references: AssetLibraryReference[] = [],
        imageGenerationMode: "text" | "reference" = "text",
        reviewFingerprint?: string,
    ) => {
        if (!project || !character) return;
        const generationType = type === "reference_sheet" ? "reference_sheet" : type;
        const isDerivedView = generationType === "three_view" || generationType === "headshot";
        if (isDerivedView && (imageGenerationMode !== "reference" || references.length !== 1)) {
            toast.warning("Select exactly one master image for this character view.");
            return;
        }
        addGeneratingTask(entityId, generationType, batchSize);
        try {
            const result = isSeriesCharacter
                ? await api.generateSeriesCharacter(seriesId!, {
                    asset_id: entityId, asset_type: "character", style_preset: "realistic",
                    generation_type: generationType, prompt, apply_style: false,
                    negative_prompt: negativePrompt, batch_size: batchSize,
                    ...(isDerivedView ? { reference: references[0] } : { references }),
                    image_generation_mode: imageGenerationMode, preserve_prompt: true,
                    expected_review_fingerprint: reviewFingerprint,
                })
                : await api.generateAsset(
                project.id,
                entityId,
                "character",
                project.style_preset || "realistic",
                "",
                generationType,
                prompt,
                false,
                negativePrompt,
                batchSize,
                resolveAssetGenerationModel(project.model_settings?.t2i_model),
                undefined,
                isDerivedView ? references[0] : undefined,
                imageGenerationMode === "reference" && !isDerivedView ? references : [],
                imageGenerationMode,
                true,
                reviewFingerprint,
                );
            if ((result as any)?._task_id) {
                const taskId = (result as any)._task_id;
                const poll = async () => {
                    const status = await api.getTaskStatus(taskId);
                    if (status?.status === "completed") {
                        if (isSeriesCharacter) setCurrentSeries(await api.getSeries(seriesId!));
                        else updateProject(project.id, await api.getProject(project.id));
                        removeGeneratingTask(entityId, generationType);
                        return;
                    }
                    if (status?.status === "failed") {
                        removeGeneratingTask(entityId, generationType);
                        return;
                    }
                    window.setTimeout(() => void poll(), 2500);
                };
                void poll();
            } else {
                if (isSeriesCharacter) setCurrentSeries(await api.getSeries(seriesId!));
                else updateProject(project.id, result);
                removeGeneratingTask(entityId, generationType);
            }
        } catch (error) {
            removeGeneratingTask(entityId, generationType);
            throw error;
        }
    };

    const onUpdateDescription = async (description: string) => {
        if (!project) return;
        if (isSeriesCharacter) setCurrentSeries(await api.updateSeriesAssetAttributes(seriesId!, entityId, "character", { description }));
        else updateProject(project.id, await api.updateAssetDescription(project.id, entityId, "character", description));
    };

    const onUpdateAttributes = async (attributes: Record<string, unknown>) => {
        if (!project) return;
        if (isSeriesCharacter) setCurrentSeries(await api.updateSeriesAssetAttributes(seriesId!, entityId, "character", attributes));
        else updateProject(project.id, await api.updateAssetAttributes(project.id, entityId, "character", attributes));
    };

    const onRename = async (name: string) => {
        if (!project) return;
        if (isSeriesCharacter) setCurrentSeries(await api.updateSeriesAssetAttributes(seriesId!, entityId, "character", { name }));
        else updateProject(project.id, await api.updateAssetAttributes(project.id, entityId, "character", { name }));
    };

    if (!project || !character) return null;
    return <CharacterWorkbench
        asset={character}
        onClose={onClose}
        onUpdateDescription={onUpdateDescription}
        onUpdateAttributes={onUpdateAttributes}
        onRename={onRename}
        onGenerate={onGenerate}
        seriesId={seriesId ?? undefined}
        generatingTypes={[]}
        stylePrompt={stylePrompt}
        styleNegativePrompt={styleNegativePrompt}
    />;
}
