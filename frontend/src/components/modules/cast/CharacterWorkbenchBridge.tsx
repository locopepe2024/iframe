"use client";

import { useProjectStore } from "@/store/projectStore";
import { api, type AssetLibraryReference } from "@/lib/api";
import { resolveAssetGenerationModel } from "@/lib/modelCatalog";
import CharacterWorkbench from "@/components/modules/CharacterWorkbench";

/**
 * Cast entry adapter. The character UI and prompt contract remain canonical
 * in CharacterWorkbench; this component only supplies the Cast workflow's
 * project callbacks.
 */
export default function CharacterWorkbenchBridge({ entityId, onClose }: { entityId: string; onClose: () => void }) {
    const project = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const addGeneratingTask = useProjectStore((state) => state.addGeneratingTask);
    const removeGeneratingTask = useProjectStore((state) => state.removeGeneratingTask);
    const character = project?.characters?.find((item: any) => item.id === entityId);

    const style = project?.art_direction?.style_config;
    const stylePrompt = style?.positive_prompt || "";
    const styleNegativePrompt = style?.negative_prompt || "";

    const onGenerate = async (
        type: string,
        prompt: string,
        applyStyle: boolean,
        negativePrompt: string,
        batchSize: number,
        references: AssetLibraryReference[] = [],
        imageGenerationMode: "text" | "reference" = "text",
    ) => {
        if (!project) return;
        const generationType = type === "reference_sheet" ? "reference_sheet" : type;
        addGeneratingTask(entityId, generationType, batchSize);
        try {
            const result = await api.generateAsset(
                project.id,
                entityId,
                "character",
                project.style_preset || "realistic",
                applyStyle ? stylePrompt : "",
                generationType,
                prompt,
                applyStyle,
                [applyStyle ? styleNegativePrompt : "", negativePrompt].filter(Boolean).join(", "),
                batchSize,
                resolveAssetGenerationModel(project.model_settings?.t2i_model),
                undefined,
                undefined,
                imageGenerationMode === "reference" ? references : [],
                imageGenerationMode,
            );
            if ((result as any)?._task_id) {
                const taskId = (result as any)._task_id;
                const poll = async () => {
                    const status = await api.getTaskStatus(taskId);
                    if (status?.status === "completed") {
                        const fresh = await api.getProject(project.id);
                        updateProject(project.id, fresh);
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
                updateProject(project.id, result);
                removeGeneratingTask(entityId, generationType);
            }
        } catch (error) {
            removeGeneratingTask(entityId, generationType);
            throw error;
        }
    };

    const onUpdateDescription = async (description: string) => {
        if (!project) return;
        const updated = await api.updateAssetDescription(project.id, entityId, "character", description);
        updateProject(project.id, updated);
    };

    if (!project || !character) return null;
    return <CharacterWorkbench
        asset={character}
        onClose={onClose}
        onUpdateDescription={onUpdateDescription}
        onGenerate={onGenerate}
        generatingTypes={[]}
        stylePrompt={stylePrompt}
        styleNegativePrompt={styleNegativePrompt}
    />;
}
