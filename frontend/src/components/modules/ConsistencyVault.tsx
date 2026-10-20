"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Paintbrush, User, Users, MapPin, Box, Lock, Unlock, RefreshCw, Upload, Image as ImageIcon, X, Check, Settings, ChevronRight, Trash2, Plus, Link as LinkIcon, Sparkles } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { agentRequest, api, API_URL, authenticatedFetch, crudApi, type AssetImageReviewRequest, type AssetLibraryReference, type ChatModel } from "@/lib/api";
import { extractErrorDetail, getAssetUrl } from "@/lib/utils";
import { includeVisibleStyle } from "@/lib/assetPromptStyle";
import CharacterWorkbench from "./CharacterWorkbench";
import ScenePromptLayersPanel from "@/components/shared/ScenePromptLayersPanel";
import { compileScenePromptLayers, sceneLightDirectionConflict, type ScenePromptLayers } from "@/lib/scenePromptLayers";
import { VariantSelector } from "../common/VariantSelector";
import { VideoVariantSelector } from "../common/VideoVariantSelector";
import UploadAssetModal from "../modals/UploadAssetModal";
import StepHeader from "@/components/shared/StepHeader";
import WorkflowActionButton from "@/components/shared/WorkflowActionButton";
import { buildCharacterVideoPrompt, DEFAULT_CHARACTER_NEGATIVE_PROMPT } from "@/lib/characterPrompts";
import { resolveAssetGenerationModel } from "@/lib/modelCatalog";
import {
    createSingleFlightTaskStatusPoller,
    mergeAssetTaskResult,
    isMissingAssetTask,
    normalizeTaskFailureDetail,
} from "@/lib/assetTaskPolling";
import ReferencePromptEditor, { type ReferenceCandidate, type ReferenceSuggestion } from "./playground/ReferencePromptEditor";
import { searchReferenceCandidates } from "@/lib/referenceCandidateSearch";
import { toast } from "@/store/toastStore";
import type { EpisodeAssetSyncDiff, EpisodeVisualContext, EpisodeVisualContextState } from "@/lib/directorShootingPlan";
import { getAssetPlanEntries, getUnboundCharacterRequirements, type AssetPlanEntry } from "@/lib/episodeAssetPlan";
import EpisodeAssetPlanPanel from "./EpisodeAssetPlanPanel";
import { SceneImageTools, type LightingReference, type SceneImageSource, type SceneToolParams } from "./SceneImageTools";
import AssetCoverBadges from "./AssetCoverBadges";
import { characterImageUrl } from "@/lib/characterImage";
import AssetNameEditor from "../common/AssetNameEditor";
import AssetWorkbenchLayout from "@/components/shared/AssetWorkbenchLayout";
import AssetImageSubmissionReview from "@/components/shared/AssetImageSubmissionReview";
import VideoPolishReview, { type VideoPolishMessages } from "./storyboard-r2v/VideoPolishReview";

export default function ConsistencyVault() {
    const tv = useTranslations("vault");
    const tStep = useTranslations("stepHeader");
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);



    const [activeTab, setActiveTab] = useState<"character" | "scene" | "prop">("character");

    // Use global state for generation status to persist across navigation
    // Refactored to track { assetId, generationType }
    const generatingTasks = useProjectStore((state) => state.generatingTasks || []); // Fallback to empty array if not defined yet
    const addGeneratingTask = useProjectStore((state) => state.addGeneratingTask);
    const removeGeneratingTask = useProjectStore((state) => state.removeGeneratingTask);

    // A completed result can arrive through a project refresh after the polling
    // callback has gone away (for example after switching panels or reloading).
    // Clear only tasks whose asset now contains a genuinely new variant; this
    // preserves the overlay while an older variant pool is still unchanged.
    useEffect(() => {
        if (!currentProject || generatingTasks.length === 0) return;
        for (const task of generatingTasks) {
            const asset = [...(currentProject.characters || []), ...(currentProject.scenes || []), ...(currentProject.props || [])]
                .find((item: any) => item.id === task.assetId) as any;
            if (!asset) continue;
            const units = [asset.reference_sheet, asset.full_body_asset, asset.three_view_asset, asset.headshot_asset];
            const variantIds = units.flatMap((unit: any) => [
                ...(Array.isArray(unit?.variants) ? unit.variants : []),
                ...(Array.isArray(unit?.image_variants) ? unit.image_variants : []),
            ]).map((variant: any) => variant?.id).filter(Boolean);
            if (variantIds.some((id: string) => !(task.initialVariantIds || []).includes(id))) {
                removeGeneratingTask(task.assetId, task.generationType);
            }
        }
    }, [currentProject, generatingTasks, removeGeneratingTask]);

    const taskFailureMessage = (error?: unknown) => {
        const detail = normalizeTaskFailureDetail(error);
        return detail ? tv("genFailedDetail", { error: detail }) : tv("genFailed");
    };

    // Store ID and Type instead of full object to ensure reactivity
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [selectedAssetType, setSelectedAssetType] = useState<string | null>(null);

    // Create asset dialog state
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

    // Upload modal state
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [uploadTarget, setUploadTarget] = useState<{ id: string; type: string; name: string; description: string } | null>(null);
    const [episodeAssetState, setEpisodeAssetState] = useState<EpisodeVisualContextState>({ context: null, bindings: [] });
    const [episodeAssetSync, setEpisodeAssetSync] = useState<EpisodeAssetSyncDiff | null>(null);
    const [syncingPlan, setSyncingPlan] = useState(false);
    const [bindingPersonId, setBindingPersonId] = useState<string | null>(null);
    const [seriesAssets, setSeriesAssets] = useState<{
        characters: Array<{ id: string; name: string }>;
        scenes: Array<{ id: string; name: string }>;
        props: Array<{ id: string; name: string }>;
    }>({ characters: [], scenes: [], props: [] });
    const [globalAssets, setGlobalAssets] = useState<{
        characters: Array<{ id: string; name: string }>;
        scenes: Array<{ id: string; name: string }>;
        props: Array<{ id: string; name: string }>;
    }>({ characters: [], scenes: [], props: [] });

    useEffect(() => {
        if (!currentProject?.id) {
            setGlobalAssets({ characters: [], scenes: [], props: [] });
            return;
        }
        let active = true;
        void api.getAssetReferenceIndex(currentProject.id).then(index => {
            if (!active) return;
            const assets = index.assets.filter(item => item.source_scope === "global");
            setGlobalAssets({
                characters: assets.filter(item => item.asset_type === "character").map(item => ({ id: item.asset_id, name: item.name })),
                scenes: assets.filter(item => item.asset_type === "scene").map(item => ({ id: item.asset_id, name: item.name })),
                props: assets.filter(item => item.asset_type === "prop").map(item => ({ id: item.asset_id, name: item.name })),
            });
        }).catch(() => { if (active) setGlobalAssets({ characters: [], scenes: [], props: [] }); });
        return () => { active = false; };
    }, [currentProject?.id]);

    useEffect(() => {
        if (!currentProject?.series_id) {
            setSeriesAssets({ characters: [], scenes: [], props: [] });
            return;
        }
        let active = true;
        void api.getSeries(currentProject.series_id).then(series => {
            if (active) setSeriesAssets({ characters: series.characters ?? [],
                scenes: series.scenes ?? [], props: series.props ?? [] });
        }).catch(() => { if (active) setSeriesAssets({ characters: [], scenes: [], props: [] }); });
        return () => { active = false; };
    }, [currentProject?.series_id]);

    useEffect(() => {
        if (!currentProject?.id) {
            setEpisodeAssetState({ context: null, bindings: [] });
            return;
        }
        let active = true;
        setEpisodeAssetState({ context: null, bindings: [] });
        setEpisodeAssetSync(null);
        void api.getEpisodeVisualContext(currentProject.id).then(state => {
            if (active) setEpisodeAssetState(state);
        }).catch(error => console.error("Failed to load episode asset context:", error));
        return () => { active = false; };
    }, [currentProject?.id]);

    // Derive selected asset from currentProject
    const selectedAsset = currentProject ? (() => {
        if (!selectedAssetId || !selectedAssetType) return null;
        const list = selectedAssetType === "character" ? currentProject.characters :
            selectedAssetType === "scene" ? currentProject.scenes :
                selectedAssetType === "prop" ? currentProject.props : [];
        return list?.find((a: any) => a.id === selectedAssetId) || null;
    })() : null;

    const isAssetGenerating = (assetId: string) => {
        return generatingTasks?.some((t: any) => t.assetId === assetId);
    };

    const getAssetGeneratingTypes = (assetId: string) => {
        return generatingTasks?.filter((t: any) => t.assetId === assetId).map((t: any) => ({
            type: t.generationType,
            batchSize: t.batchSize
        })) || [];
    };

    const handleUpdateDescription = async (assetId: string, type: string, description: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.updateAssetDescription(currentProject.id, assetId, type, description);
            await applyAssetMutationProject(assetId, type, updatedProject);
        } catch (error) {
            console.error("Failed to update description:", error);
        }
    };

    const handleUpdateAttributes = async (assetId: string, type: string, attributes: Record<string, unknown>) => {
        if (!currentProject) return;
        try {
            if (type === "character" && Object.keys(attributes).length === 1 && "character_design" in attributes) {
                const saved = await api.saveCharacterDesign(currentProject.id, assetId, attributes.character_design);
                if (saved.project_id !== currentProject.id || saved.asset_id !== assetId || !saved.character_design
                    || !Number.isInteger(saved.asset_revision) || saved.asset_revision < 0) {
                    throw new Error("Saved character design response is invalid");
                }
                // Merge into the latest state: generation may finish while saving.
                const latest = useProjectStore.getState();
                const project = latest.currentProject?.id === currentProject.id
                    ? latest.currentProject : latest.projects.find(item => item.id === currentProject.id);
                if (project) updateProject(currentProject.id, {
                    characters: project.characters.map(character => character.id === assetId
                        ? { ...character, character_design: saved.character_design,
                            asset_revision: Math.max(character.asset_revision || 0, saved.asset_revision) } : character),
                });
                return;
            }
            const updatedProject = await api.updateAssetAttributes(currentProject.id, assetId, type, attributes);
            await applyAssetMutationProject(assetId, type, updatedProject);
        } catch (error) {
            console.error("Failed to update asset attributes:", error);
            throw error;
        }
    };

    const handleRenameAsset = async (assetId: string, type: string, name: string) => {
        if (!currentProject) return;
        const updatedProject = await api.updateAssetAttributes(currentProject.id, assetId, type, { name });
        await applyAssetMutationProject(assetId, type, updatedProject);
    };

    const applyAssetMutationProject = async (assetId: string, type: string, response: any) => {
        if (!currentProject) return;
        const key = type === "character" ? "characters" : type === "scene" ? "scenes" : "props";
        // A mutation response must retain the merged episode/series asset view.
        // Recover from older or partial responses before updating local state;
        // otherwise the selected asset disappears and its workbench unmounts.
        const collections = ["characters", "scenes", "props"] as const;
        const hasVisibleAssets = (project: any) => collections.every(collection => {
            const returned = project?.[collection];
            return Array.isArray(returned) && (currentProject[collection] ?? []).every(
                (asset: { id: string }) => returned.some((item: { id?: string }) => item.id === asset.id));
        });
        const hasUpdatedAsset = (project: any) => project[key]?.some(
            (asset: { id?: string }) => asset.id === assetId);
        if (!hasVisibleAssets(response) || !hasUpdatedAsset(response)) {
            const freshProject = await api.getProject(currentProject.id);
            if (!hasUpdatedAsset(freshProject)) {
                throw new Error("Updated asset is missing from the project response");
            }
            updateProject(currentProject.id, freshProject);
            return;
        }
        updateProject(currentProject.id, response);
    };

    const handleClearGenerationState = async (assetId: string, type: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.clearAssetGenerationState(currentProject.id, type, assetId);
            updateProject(currentProject.id, updatedProject);
        } catch (error: any) {
            alert(error?.response?.data?.detail || error?.message || "Failed to clear generation state");
        }
    };

    const handleGenerate = async (assetId: string, type: string, generationType: string = "all", prompt: string = "", _applyStyle: boolean = false, negativePrompt: string = "", batchSize: number = 1, references: AssetLibraryReference[] = [], imageGenerationMode: "text" | "reference" = "text", _preservePrompt: boolean = true, reviewFingerprint?: string, sceneTool?: SceneToolParams) => {
        if (!currentProject) return;
        if (!prompt.trim()) {
            toast.warning("Review and enter the final image prompt before generating.");
            return;
        }
        const isDerivedCharacter = type === "character" && (generationType === "three_view" || generationType === "headshot");
        if (isDerivedCharacter && (imageGenerationMode !== "reference" || references.length !== 1)) {
            toast.warning("Select exactly one master image in Reference image mode for this character view.");
            return;
        }

        // Add task with specific generation type and batch size
        if (addGeneratingTask) {
            const asset = [...(currentProject.characters || []), ...(currentProject.scenes || []), ...(currentProject.props || [])]
                .find((item: any) => item.id === assetId) as any;
            const initialVariantIds = [asset?.reference_sheet, asset?.full_body_asset, asset?.three_view_asset, asset?.headshot_asset]
                .flatMap((unit: any) => [
                    ...(Array.isArray(unit?.variants) ? unit.variants : []),
                    ...(Array.isArray(unit?.image_variants) ? unit.image_variants : []),
                ]).map((variant: any) => variant?.id).filter(Boolean);
            addGeneratingTask(assetId, generationType, batchSize, initialVariantIds);
        }

        try {
            console.log("[handleGenerate] Starting asset generation...");

            // Call API - now returns immediately with task_id
            const response = await api.generateAsset(
                currentProject.id,
                assetId,
                type,
                "ArtDirection",
                "",
                generationType,
                prompt,
                false,
                negativePrompt,
                batchSize,
                currentProject.series_id ? undefined : resolveAssetGenerationModel(currentProject.model_settings?.t2i_model),
                undefined,
                isDerivedCharacter ? references[0] : undefined,
                isDerivedCharacter ? [] : references,
                imageGenerationMode,
                true,
                reviewFingerprint,
                sceneTool,
            );

            const taskId = response._task_id;
            console.log("[handleGenerate] Got task_id:", taskId);

            // Start polling if we got a task_id
            if (taskId) {
                let pollInterval: ReturnType<typeof setInterval>;
                const pollOnce = createSingleFlightTaskStatusPoller(
                    () => api.getTaskStatus(taskId),
                    (status) => status.status === "completed" || status.status === "failed",
                    (status) => {
                        console.log("[Polling] Task status:", status.status);

                        if (status.status === "completed") {
                            clearInterval(pollInterval);
                            const store = useProjectStore.getState();
                            const latestProject = store.projects.find((project) => project.id === currentProject.id)
                                || (store.currentProject?.id === currentProject.id ? store.currentProject : null);
                            const patch = mergeAssetTaskResult(latestProject, status);
                            if (patch) store.updateProject(currentProject.id, patch);
                            else {
                                console.error("Completed asset task did not include its target asset snapshot", taskId);
                                void api.getProject(currentProject.id).then((fresh) => {
                                    useProjectStore.getState().updateProject(currentProject.id, fresh);
                                }).catch((refreshError) => {
                                    console.error("Failed to refresh project after asset task:", refreshError);
                                });
                            }
                            console.log("Asset generated successfully (async)");
                            store.removeGeneratingTask(assetId, generationType);
                        } else if (status.status === "failed") {
                            clearInterval(pollInterval);
                            console.error("Asset generation failed:", status.error);
                            alert(taskFailureMessage(status.error));

                            if (removeGeneratingTask) {
                                removeGeneratingTask(assetId, generationType);
                            }

                            void api.getProject(currentProject.id).then((fresh) => {
                                useProjectStore.getState().updateProject(currentProject.id, fresh);
                            }).catch((refreshError) => {
                                console.error("Failed to refresh project:", refreshError);
                            });
                        }
                        // If status is "pending" or "processing", continue polling.
                    },
                );
                pollInterval = setInterval(() => {
                    void pollOnce().catch((pollError) => {
                        if (isMissingAssetTask(pollError)) {
                            clearInterval(pollInterval);
                            removeGeneratingTask(assetId, generationType);
                            toast.error("iFrame 已找不到这次生成的任务记录，可能在服务重启时中断。请先核对 UniArt 任务结果，避免重复提交。");
                            void api.getProject(currentProject.id).then((fresh) => {
                                useProjectStore.getState().updateProject(currentProject.id, fresh);
                            }).catch((error) => console.error("Failed to refresh missing asset task:", error));
                            return;
                        }
                        console.error("Polling error:", pollError);
                        // A network failure does not cancel the backend task.
                        // Keep polling so its final provider error is shown.
                    });
                }, 2000); // Poll every 2 seconds
            } else {
                // Fallback: no task_id means sync response (shouldn't happen, but just in case)
                console.warn("[handleGenerate] No task_id in response, falling back to sync mode");
                updateProject(currentProject.id, response);
                console.log("Asset generated successfully");
                if (removeGeneratingTask) {
                    removeGeneratingTask(assetId, generationType);
                }
            }
        } catch (error: any) {
            console.error("Failed to generate asset:", error);
            alert(tv('startGenFailed', { error: error.response?.data?.detail || error.message }));
            if (removeGeneratingTask) {
                removeGeneratingTask(assetId, generationType);
            }
        }
    };

    // Delete asset handler
    const handleDeleteAsset = async (assetId: string, type: string) => {
        if (!currentProject) return;
        if (!confirm(`Are you sure you want to delete this ${type}?`)) return;

        try {
            const asset = (type === "character" ? currentProject.characters :
                type === "scene" ? currentProject.scenes : currentProject.props)
                ?.find((item: any) => item.id === assetId);
            if (asset?.source === "series" && currentProject.series_id) {
                try {
                    await api.deleteSeriesAsset(currentProject.series_id, type as "character" | "scene" | "prop", assetId);
                } catch (error) {
                    const detail = (error as any)?.response?.data?.detail;
                    if (detail?.error !== "series_asset_in_use" || !confirm("该资产仍被分集引用。强制删除将解除当前分镜和资产绑定；已确认拍摄计划的历史 ID 会保留，需在新版本中重新关联。继续删除？")) throw error;
                    await api.deleteSeriesAsset(currentProject.series_id, type as "character" | "scene" | "prop", assetId, true);
                }
            } else if (type === "character") {
                await crudApi.deleteCharacter(currentProject.id, assetId);
            } else if (type === "scene") {
                await crudApi.deleteScene(currentProject.id, assetId);
            } else if (type === "prop") {
                await crudApi.deleteProp(currentProject.id, assetId);
            }
        } catch (error) {
            console.error("Failed to delete asset:", error);
            const detail = (error as any)?.response?.data?.detail;
            alert(detail?.error === "series_asset_in_use"
                ? "资产仍被分集引用，删除未完成。请刷新后重试或检查引用。"
                : extractErrorDetail(error, "Failed to delete asset"));
            return;
        }

        // Deletion retires mappings; the persisted context needs a fresh projection.
        const isCurrentProject = () => useProjectStore.getState().currentProject?.id === currentProject.id;
        if (isCurrentProject()) {
            setEpisodeAssetSync(null);
            setEpisodeAssetState({ context: null, bindings: [] });
            setSeriesAssets({ characters: [], scenes: [], props: [] });
        }
        const [projectResult, contextResult, seriesResult] = await Promise.allSettled([
            api.getProject(currentProject.id),
            episodeAssetState.context
                ? api.syncEpisodeAssetsFromShootingPlan(currentProject.id)
                : api.getEpisodeVisualContext(currentProject.id),
            currentProject.series_id ? api.getSeries(currentProject.series_id) : Promise.resolve(null),
        ]);
        if (!isCurrentProject()) return;
        if (projectResult.status === "fulfilled") updateProject(currentProject.id, projectResult.value);
        if (contextResult.status === "fulfilled") {
            setEpisodeAssetState({ context: contextResult.value.context, bindings: contextResult.value.bindings });
        }
        if (seriesResult.status === "fulfilled" && seriesResult.value) {
            setSeriesAssets({ characters: seriesResult.value.characters ?? [],
                scenes: seriesResult.value.scenes ?? [], props: seriesResult.value.props ?? [] });
        }
        const failedRefresh = [projectResult, contextResult, seriesResult].find(result => result.status === "rejected");
        if (failedRefresh?.status === "rejected") {
            toast.error("资产已删除，部分数据刷新失败", { body: extractErrorDetail(failedRefresh.reason, "请刷新页面后重试同步") });
        }
    };

    // Create asset handler
    const handleCreateAsset = async (data: { name: string; description: string }) => {
        if (!currentProject) return;

        try {
            if (activeTab === "character") {
                await crudApi.createCharacter(currentProject.id, data);
            } else if (activeTab === "scene") {
                await crudApi.createScene(currentProject.id, data);
            } else if (activeTab === "prop") {
                await crudApi.createProp(currentProject.id, data);
            }
            // Refresh project data
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
            setIsCreateDialogOpen(false);
        } catch (error) {
            console.error("Failed to create asset:", error);
            alert("Failed to create asset");
        }
    };

    // Video Handlers
    const handleGenerateVideo = async (assetId: string, type: string, prompt: string, duration: number, assetSubType: string = "full_body") => {
        if (!currentProject) return;

        // Validate and map the assetSubType to ensure correct values are passed
        let finalAssetType: 'full_body' | 'head_shot' | 'scene' | 'prop' = 'full_body';

        // Different mappings based on the type of asset
        if (type === "scene") {
            finalAssetType = "scene";
        } else if (type === "prop") {
            finalAssetType = "prop";
        } else {
            // For character types, ensure assetSubType is valid
            if (assetSubType === "head_shot") {
                finalAssetType = "head_shot";
            } else {
                finalAssetType = "full_body";  // default to full_body
            }
        }

        // Use a more specific generation type to avoid state pollution
        const generationType = assetSubType === "head_shot" ? "video_head_shot" : "video_full_body";

        if (addGeneratingTask) {
            addGeneratingTask(assetId, generationType, 1);
        }

        try {
            console.log(`[handleGenerateVideo] Starting ${generationType} generation for asset ${type}, type: ${finalAssetType}...`);
            const response = await api.generateMotionRef(
                currentProject.id,
                assetId,
                finalAssetType,
                prompt,
                undefined, // audioUrl
                duration
            );

            const taskId = response._task_id;
            console.log("[handleGenerateVideo] Got task_id:", taskId);

            if (taskId) {
                let pollInterval: ReturnType<typeof setInterval>;
                const pollOnce = createSingleFlightTaskStatusPoller(
                    () => api.getTaskStatus(taskId),
                    (status) => status.status === "completed" || status.status === "failed",
                    (status) => {
                        console.log(`[Video Polling] Task ${taskId} status:`, status.status);

                        if (status.status === "completed") {
                            clearInterval(pollInterval);
                            const store = useProjectStore.getState();
                            const latestProject = store.projects.find((project) => project.id === currentProject.id)
                                || (store.currentProject?.id === currentProject.id ? store.currentProject : null);
                            const patch = mergeAssetTaskResult(latestProject, status);
                            if (patch) {
                                store.updateProject(currentProject.id, patch);
                            } else {
                                console.error("Completed motion task did not include its target asset snapshot", taskId);
                                void api.getProject(currentProject.id).then((fresh) => {
                                    useProjectStore.getState().updateProject(currentProject.id, fresh);
                                }).catch((refreshError) => {
                                    console.error("Failed to refresh project after motion task:", refreshError);
                                });
                            }
                            store.removeGeneratingTask(assetId, generationType);
                            console.log(`[Video Polling] ${generationType} generated successfully`);
                        } else if (status.status === "failed") {
                            clearInterval(pollInterval);
                            alert(taskFailureMessage(status.error));
                            if (removeGeneratingTask) {
                                removeGeneratingTask(assetId, generationType);
                            }
                            void api.getProject(currentProject.id).then((fresh) => {
                                useProjectStore.getState().updateProject(currentProject.id, fresh);
                            }).catch((refreshError) => {
                                console.error("Failed to refresh project:", refreshError);
                            });
                        }
                        // Pending and processing statuses keep polling.
                    },
                );
                pollInterval = setInterval(() => {
                    void pollOnce().catch((pollError) => {
                        if (isMissingAssetTask(pollError)) {
                            clearInterval(pollInterval);
                            removeGeneratingTask(assetId, generationType);
                            toast.error("iFrame 已找不到这次动态参考任务记录。请先核对 UniArt 任务结果，避免重复提交。");
                            return;
                        }
                        console.error("Video polling error:", pollError);
                        // The server task remains active; retry on the next tick.
                    });
                }, 3000); // Poll every 3 seconds for video
            } else {
                // Fallback for sync response
                updateProject(currentProject.id, response);
                if (removeGeneratingTask) {
                    removeGeneratingTask(assetId, generationType);
                }
            }
        } catch (error: any) {
            console.error("Failed to generate video:", error);
            alert(tv('startGenFailed', { error: error.response?.data?.detail || error.message }));
            if (removeGeneratingTask) {
                removeGeneratingTask(assetId, generationType);
            }
        }
    };

    const handleDeleteVideo = async (assetId: string, type: string, videoId: string) => {
        if (!currentProject) return;
        if (!confirm("Are you sure you want to delete this video? This action cannot be undone.")) return;

        try {
            await api.deleteAssetVideo(currentProject.id, type, assetId, videoId);
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error: any) {
            console.error("Failed to delete video:", error);
            alert(`Failed to delete video: ${error.message}`);
        }
    };

    const handleSyncShootingPlan = async () => {
        if (!currentProject) return;
        setSyncingPlan(true);
        try {
            const diff = await api.syncEpisodeAssetsFromShootingPlan(currentProject.id);
            setEpisodeAssetSync(diff);
            setEpisodeAssetState({ context: diff.context, bindings: diff.bindings });
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error: any) {
            alert(error?.response?.data?.detail || error?.message || "请先确认拍摄计划");
        } finally {
            setSyncingPlan(false);
        }
    };

    const handleBindPersonAsset = async (personId: string, assetId: string | null) => {
        if (!currentProject || !episodeAssetState.context) return;
        setBindingPersonId(personId);
        try {
            const diff = await api.bindEpisodePersonAsset(
                currentProject.id, personId, assetId, episodeAssetState.context.shooting_plan_revision);
            setEpisodeAssetSync(diff);
            setEpisodeAssetState({ context: diff.context, bindings: diff.bindings });
            updateProject(currentProject.id, await api.getProject(currentProject.id));
        } catch (error) {
            toast.error("角色资产关联失败", { body: extractErrorDetail(error) });
        } finally {
            setBindingPersonId(null);
        }
    };

    const handleBindPlanAsset = async (assetType: "scene" | "prop", planAssetIds: string[], assetId: string) => {
        if (!currentProject || !episodeAssetState.context || !assetId || !planAssetIds.length) return;
        setBindingPersonId(`${assetType}:${planAssetIds[0]}`);
        try {
            const diff = await api.bindEpisodePlanAsset(currentProject.id, assetType, planAssetIds,
                assetId, episodeAssetState.context.shooting_plan_revision);
            setEpisodeAssetSync(diff);
            setEpisodeAssetState({ context: diff.context, bindings: diff.bindings });
            updateProject(currentProject.id, await api.getProject(currentProject.id));
        } catch (error) {
            toast.error("资产关联失败", { body: extractErrorDetail(error) });
        } finally {
            setBindingPersonId(null);
        }
    };

    const handleBindPlanScene = async (sceneId: string, assetId: string) => {
        if (!currentProject || !episodeAssetState.context || !assetId) return;
        setBindingPersonId(`scene:${sceneId}`);
        try {
            const diff = await api.bindEpisodePlanScene(currentProject.id, sceneId, null,
                assetId, episodeAssetState.context.shooting_plan_revision);
            setEpisodeAssetSync(diff);
            setEpisodeAssetState({ context: diff.context, bindings: diff.bindings });
            updateProject(currentProject.id, await api.getProject(currentProject.id));
        } catch (error) {
            toast.error("场景资产关联失败", { body: extractErrorDetail(error) });
        } finally {
            setBindingPersonId(null);
        }
    };

    // Upload handlers
    const handleOpenUploadModal = (asset: any, type: string) => {
        setUploadTarget({
            id: asset.id,
            type: type,
            name: asset.name,
            description: asset.description
        });
        setIsUploadModalOpen(true);
    };

    const handleUploadComplete = async (updatedScript: any) => {
        if (currentProject) {
            updateProject(currentProject.id, updatedScript);
        }
        setIsUploadModalOpen(false);
        setUploadTarget(null);
    };

    const assets = activeTab === "character" ? currentProject?.characters :
        activeTab === "scene" ? currentProject?.scenes :
            activeTab === "prop" ? currentProject?.props : [];
    const selectedPlanEntries = selectedAssetId && selectedAssetType
        ? getAssetPlanEntries(episodeAssetState.context, selectedAssetType as "character" | "scene" | "prop", selectedAssetId)
        : [];

    return (
        <div className="flex flex-col h-full text-foreground">
            <StepHeader
                stepNumber={3}
                totalSteps={6}
                icon={<Users />}
                englishName="Asset Library"
                title={tStep("vaultTitle")}
                subtitle={tStep("vaultSubtitle")}
            />
            {/* Tab bar + sync action */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-glass-border bg-surface">
                <div className="flex gap-2">
                    <TabButton
                        active={activeTab === "character"}
                        onClick={() => setActiveTab("character")}
                        icon={<User size={14} />}
                        label="Characters"
                        count={currentProject?.characters?.length || 0}
                    />
                    <TabButton
                        active={activeTab === "scene"}
                        onClick={() => setActiveTab("scene")}
                        icon={<MapPin size={14} />}
                        label="Scenes"
                        count={currentProject?.scenes?.length || 0}
                    />
                    <TabButton
                        active={activeTab === "prop"}
                        onClick={() => setActiveTab("prop")}
                        icon={<Box size={14} />}
                        label="Props"
                        count={currentProject?.props?.length || 0}
                    />
                </div>

                <WorkflowActionButton
                    variant="secondary"
                    size="sm"
                    leftIcon={<RefreshCw />}
                    onClick={handleSyncShootingPlan}
                    disabled={syncingPlan}
                    title="将已确认拍摄计划的场景、角色、道具和镜头约束同步到本集资产"
                >
                    {syncingPlan ? "同步中" : "从拍摄计划同步"}
                </WorkflowActionButton>
            </div>
            {episodeAssetSync && (
                <div className="mx-6 mt-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-text-secondary">
                    <span className="font-medium text-foreground">拍摄计划上下文已同步：</span>{" "}
                    新增记录 {episodeAssetSync.new_bindings?.length || 0} · 可复用记录 {episodeAssetSync.reusable_bindings?.length || 0} ·
                    变更记录 {episodeAssetSync.changed_bindings?.length || 0} · 过期记录 {episodeAssetSync.stale_bindings?.length || 0}。
                    资产不会被自动生成或覆盖。
                    {!!episodeAssetSync.unresolved_bindings.length && <span> 待处理 {episodeAssetSync.unresolved_bindings.length} 条需求（含逐镜头场景需求），请在下方关联现有资产或检查拍摄计划引用。</span>}
                </div>
            )}

            {((episodeAssetSync?.bindings.length || episodeAssetState.bindings.length) > 0 ||
                episodeAssetState.context?.scenes.some(scene => !scene.scene_asset_id &&
                    (!episodeAssetState.context?.shots.some(shot => shot.scene_id === scene.scene_id) ||
                    episodeAssetState.context?.shots.some(shot => shot.scene_id === scene.scene_id && !shot.scene_asset_id))) ||
                getUnboundCharacterRequirements(episodeAssetState.context).length > 0) && currentProject && (
                <ShootingPlanAssetRequirements
                    bindings={episodeAssetSync?.bindings || episodeAssetState.bindings}
                    context={episodeAssetState.context}
                    project={currentProject}
                    seriesAssets={seriesAssets}
                    globalAssets={globalAssets}
                    bindingPersonId={bindingPersonId}
                    onBindPersonAsset={handleBindPersonAsset}
                    onBindPlanAsset={handleBindPlanAsset}
                    onBindPlanScene={handleBindPlanScene}
                    onOpenAsset={(assetType, assetId) => {
                        setActiveTab(assetType);
                        setSelectedAssetType(assetType);
                        setSelectedAssetId(assetId);
                    }}
                />
            )}

            {/* Content Grid */}
            {currentProject?.workflow_mode !== "i2v_legacy" && (
                <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20 flex items-start gap-3">
                    <Paintbrush size={16} className="text-primary mt-0.5 shrink-0" />
                    <div>
                        <p className="text-sm font-medium text-foreground">{tv("r2vModeActive")}</p>
                        <p className="text-xs text-text-secondary mt-0.5">
                            {tv("r2vBannerDesc")}
                        </p>
                    </div>
                </div>
            )}
            <div className="flex-1 overflow-y-auto p-6">
                {!currentProject ? (
                    <div className="flex items-center justify-center h-full text-text-muted">
                        Loading project...
                    </div>
                ) : assets?.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
                        <div className="w-16 h-16 rounded-full bg-glass flex items-center justify-center">
                            {activeTab === "character" ? <User size={32} /> : activeTab === "scene" ? <MapPin size={32} /> : <Box size={32} />}
                        </div>
                        <p>No {activeTab}s found</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                        {assets?.map((asset: any) => (
                            <AssetCard
                                key={asset.id}
                                asset={asset}
                                type={activeTab}
                                isGenerating={isAssetGenerating(asset.id)}
                                onGenerate={() => {
                                    setSelectedAssetId(asset.id);
                                    setSelectedAssetType(activeTab);
                                }}
                                onToggleLock={() => api.toggleAssetLock(currentProject.id, asset.id, activeTab).then(updated => updateProject(currentProject.id, updated))}
                                onClick={() => {
                                    setSelectedAssetId(asset.id);
                                    setSelectedAssetType(activeTab);
                                }}
                                onDelete={() => handleDeleteAsset(asset.id, activeTab)}
                                onUpload={() => handleOpenUploadModal(asset, activeTab)}
                                onClearGenerationState={() => handleClearGenerationState(asset.id, activeTab)}
                                planCount={getAssetPlanEntries(episodeAssetState.context, activeTab, asset.id).length}
                            />
                        ))}
                        {/* Create New Asset Button */}
                        <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            onClick={() => setIsCreateDialogOpen(true)}
                            className="group relative aspect-[3/4] bg-surface rounded-2xl border-2 border-dashed border-glass-border hover:border-primary/50 overflow-hidden transition-all cursor-pointer flex items-center justify-center hover:bg-glass"
                        >
                            <div className="flex flex-col items-center gap-3 text-text-secondary group-hover:text-primary transition-colors">
                                <Plus size={40} />
                                <span className="text-sm font-medium">Add {activeTab}</span>
                            </div>
                        </motion.div>
                    </div>
                )}
            </div>

            {/* Detail Modal / Workbench */}
            <AnimatePresence>
                {selectedAsset && selectedAssetId && selectedAssetType && (
                    selectedAssetType === "character" ? (
                        <CharacterWorkbench
                            key={selectedAssetId}
                            asset={selectedAsset}
                            onClose={() => {
                                setSelectedAssetId(null);
                                setSelectedAssetType(null);
                            }}
                            onUpdateDescription={(desc: string) => handleUpdateDescription(selectedAssetId, selectedAssetType, desc)}
                            onUpdateAttributes={(attributes: Record<string, unknown>) => handleUpdateAttributes(selectedAssetId, selectedAssetType, attributes)}
                            onRename={(name: string) => handleRenameAsset(selectedAssetId, selectedAssetType, name)}
                            onGenerate={(type: string, prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number, references?: AssetLibraryReference[], imageGenerationMode?: "text" | "reference", reviewFingerprint?: string) => handleGenerate(selectedAssetId, selectedAssetType, type, prompt, applyStyle, negativePrompt, batchSize, references, imageGenerationMode, true, reviewFingerprint)}
                            generatingTypes={getAssetGeneratingTypes(selectedAssetId)}
                            stylePrompt={currentProject?.art_direction?.style_config?.positive_prompt || ""}
                            styleNegativePrompt={currentProject?.art_direction?.style_config?.negative_prompt || ""}
                            planEntries={selectedPlanEntries}
                            onGenerateVideo={(prompt: string, duration: number, subType?: string) => handleGenerateVideo(selectedAssetId, selectedAssetType, prompt, duration, subType || "video")}
                            onDeleteVideo={(videoId: string) => handleDeleteVideo(selectedAssetId, selectedAssetType, videoId)}
                        />
                    ) : (
                        <CharacterDetailModal
                            key={selectedAssetId}
                            asset={selectedAsset}
                            type={selectedAssetType}
                            onClose={() => {
                                setSelectedAssetId(null);
                                setSelectedAssetType(null);
                            }}
                            onUpdateDescription={(desc: string) => handleUpdateDescription(selectedAssetId, selectedAssetType, desc)}
                            onUpdateAttributes={(attributes: Record<string, unknown>) => handleUpdateAttributes(selectedAssetId, selectedAssetType, attributes)}
                            onRename={(name: string) => handleRenameAsset(selectedAssetId, selectedAssetType, name)}
                            onGenerate={(prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number, references?: AssetLibraryReference[], imageGenerationMode?: "text" | "reference", preservePrompt?: boolean, reviewFingerprint?: string, sceneTool?: SceneToolParams) => handleGenerate(selectedAssetId, selectedAssetType, "all", prompt, applyStyle, negativePrompt, batchSize, references, imageGenerationMode, preservePrompt, reviewFingerprint, sceneTool)}
                            isGenerating={isAssetGenerating(selectedAssetId)}
                            stylePrompt={currentProject?.art_direction?.style_config?.positive_prompt || ""}
                            styleNegativePrompt={currentProject?.art_direction?.style_config?.negative_prompt || ""}
                            planEntries={selectedPlanEntries}
                            onGenerateVideo={(prompt: string, duration: number) => handleGenerateVideo(selectedAssetId, selectedAssetType, prompt, duration, "video")}
                            onDeleteVideo={(videoId: string) => handleDeleteVideo(selectedAssetId, selectedAssetType, videoId)}
                            isGeneratingVideo={getAssetGeneratingTypes(selectedAssetId).some((t: any) => t.type.startsWith("video"))}
                        />
                    )
                )}
            </AnimatePresence>



            {/* Create Asset Dialog */}
            <AnimatePresence>
                {isCreateDialogOpen && (
                    <CreateAssetDialog
                        type={activeTab}
                        onClose={() => setIsCreateDialogOpen(false)}
                        onCreate={handleCreateAsset}
                    />
                )}
            </AnimatePresence>

            {/* Upload Asset Modal */}
            {uploadTarget && currentProject && (
                <UploadAssetModal
                    isOpen={isUploadModalOpen}
                    onClose={() => {
                        setIsUploadModalOpen(false);
                        setUploadTarget(null);
                    }}
                    assetId={uploadTarget.id}
                    assetType={uploadTarget.type as "character" | "scene" | "prop"}
                    assetName={uploadTarget.name}
                    defaultDescription={uploadTarget.description}
                    scriptId={currentProject.id}
                    onUploadComplete={handleUploadComplete}
                />
            )}
        </div >
    );
}

function ShootingPlanAssetRequirements({
    bindings,
    context,
    project,
    seriesAssets,
    globalAssets,
    bindingPersonId,
    onBindPersonAsset,
    onBindPlanAsset,
    onBindPlanScene,
    onOpenAsset,
}: {
    bindings: EpisodeVisualContextState["bindings"];
    context: EpisodeVisualContext | null;
    project: any;
    seriesAssets: { characters: Array<{ id: string; name: string }>;
        scenes: Array<{ id: string; name: string }>; props: Array<{ id: string; name: string }> };
    globalAssets: { characters: Array<{ id: string; name: string }>;
        scenes: Array<{ id: string; name: string }>; props: Array<{ id: string; name: string }> };
    bindingPersonId: string | null;
    onBindPersonAsset: (personId: string, assetId: string | null) => Promise<void>;
    onBindPlanAsset: (assetType: "scene" | "prop", planAssetIds: string[], assetId: string) => Promise<void>;
    onBindPlanScene: (sceneId: string, assetId: string) => Promise<void>;
    onOpenAsset: (assetType: "character" | "scene" | "prop", assetId: string) => void;
}) {
    const scopeLabel = (source?: "episode" | "series" | "global") =>
        source === "series" ? "系列共享" : source === "global" ? "个人资产" : "本集资产";
    const unboundCharacters = getUnboundCharacterRequirements(context);
    const people = new Map<string, { label: string; assetIds: string[]; sceneIds: string[]; shotIds: string[]; lookCount: number }>();
    for (const character of context?.characters ?? []) {
        const item = people.get(character.person_id) ?? { label: character.person_label || `人物 ${people.size + 1}`, assetIds: [], sceneIds: [], shotIds: [], lookCount: 0 };
        item.assetIds = Array.from(new Set([...item.assetIds, ...character.character_asset_ids]));
        item.sceneIds = Array.from(new Set([...item.sceneIds, ...character.scene_ids]));
        item.shotIds = Array.from(new Set([...item.shotIds, ...character.shot_ids]));
        item.lookCount += 1;
        people.set(character.person_id, item);
    }
    const representedCharacterIds = new Set(Array.from(people.values()).flatMap(item => item.assetIds));
    const currentBindings = bindings.filter(item => item.status !== "stale");
    const unboundScenes = context?.scenes.filter(scene => !scene.scene_asset_id &&
        (!context.shots.some(shot => shot.scene_id === scene.scene_id) ||
        context.shots.some(shot => shot.scene_id === scene.scene_id && !shot.scene_asset_id))) ?? [];
    const groups: Array<{ type: "character" | "scene" | "prop"; label: string; items: typeof bindings }> = [
        { type: "character", label: "角色", items: currentBindings.filter(item => item.asset_type === "character" && !representedCharacterIds.has(item.asset_id)) },
        { type: "scene", label: "场景", items: currentBindings.filter(item => item.asset_type === "scene") },
        { type: "prop", label: "道具", items: currentBindings.filter(item => item.asset_type === "prop") },
    ];
    const assetsForType = (type: "character" | "scene" | "prop") => {
        const key = type === "character" ? "characters" : type === "scene" ? "scenes" : "props";
        const local: Array<{ id: string; name: string; source?: "episode" | "series" | "global" }> = project[key] ?? [];
        const series = seriesAssets[key].filter(asset => !local.some(item => item.id === asset.id))
            .map(asset => ({ ...asset, source: "series" as const }));
        const globals = globalAssets[key].filter(asset => !local.some(item => item.id === asset.id)
            && !series.some(item => item.id === asset.id))
            .map(asset => ({ ...asset, source: "global" as const }));
        return [...local, ...series, ...globals];
    };
    const getAsset = (type: "character" | "scene" | "prop", id: string) =>
        assetsForType(type).find(asset => asset.id === id);
    const sceneLabelsForAsset = (assetId: string) => Array.from(new Set(
        (context?.scenes ?? []).filter(scene => scene.scene_asset_id === assetId ||
            context?.shots.some(shot => shot.scene_id === scene.scene_id && shot.scene_asset_id === assetId))
            .map(scene => scene.scene_ref || scene.location || scene.scene_id)
    ));
    const planSourcesByAsset = (type: "scene" | "prop") => {
        const sources = new Map<string, Set<string>>();
        const add = (sourceId: string, assetId: string) => {
            const ids = sources.get(assetId) ?? new Set<string>();
            ids.add(sourceId);
            sources.set(assetId, ids);
        };
        if (type === "scene") {
            for (const scene of context?.scenes ?? []) {
                if (scene.plan_scene_asset_id) add(scene.plan_scene_asset_id, scene.scene_asset_id ?? scene.plan_scene_asset_id);
            }
            for (const shot of context?.shots ?? []) {
                if (shot.plan_scene_asset_id) add(shot.plan_scene_asset_id, shot.scene_asset_id ?? shot.plan_scene_asset_id);
            }
        } else {
            for (const prop of context?.props ?? []) {
                add(prop.plan_prop_id ?? prop.prop_id, prop.prop_id);
            }
        }
        return sources;
    };
    const statusLabel = (status: string) => status === "accepted" ? "已采纳" : status === "stale" ? "需复核" : "候选引用";

    return (
        <section className="mx-6 mt-3 rounded-lg border border-glass-border bg-surface px-4 py-3" aria-label="拍摄计划资产需求">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <h3 className="text-sm font-medium text-foreground">拍摄计划资产需求</h3>
                    <p className="mt-1 text-xs text-text-secondary">重新提炼会生成新的资产 ID；场景和道具若仍显示待关联，请在对应需求中选择新资产。同步不会按名称自动关联或生成资产。</p>
                </div>
                <span className="text-xs text-text-muted">{currentBindings.length} 条绑定{unboundCharacters.length > 0 && ` · ${unboundCharacters.length} 个人物待绑定`}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
                {groups.map(group => (
                    <div key={group.type} className="min-w-0 rounded-md border border-glass-border bg-glass/40 p-3">
                        <div className="flex items-center justify-between text-xs font-medium text-text-secondary">
                            <span>{group.label}</span><span>{group.items.length + (group.type === "character" ? people.size : group.type === "scene" ? unboundScenes.length : 0)}</span>
                        </div>
                        {group.items.length === 0 && (group.type !== "character" || people.size === 0)
                            && (group.type !== "scene" || unboundScenes.length === 0) ? (
                            <p className="mt-2 text-xs text-text-muted">暂无拍摄计划需求</p>
                        ) : (
                            <div className={`mt-2 space-y-2 overflow-y-auto ${group.type === "character" ? "max-h-80" : "max-h-32"}`}>
                                {group.items.map(binding => {
                                    const asset = getAsset(group.type, binding.asset_id);
                                    const sceneLabels = group.type === "scene" ? sceneLabelsForAsset(binding.asset_id) : [];
                                    const sourceIds = group.type === "character" ? [] :
                                        Array.from(planSourcesByAsset(group.type).get(binding.asset_id) ?? []);
                                    return (
                                        <div key={`${group.type}:${binding.asset_id}`} className="rounded border border-glass-border/70 px-2 py-1.5">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    {sceneLabels.length > 0 && <p className="text-xs text-foreground">计划场景 · {sceneLabels.join("、")}</p>}
                                                    <p className="text-xs text-foreground">{group.type === "scene" && sceneLabels.length > 0 ? "关联场景资产 · " : ""}{asset ? `${asset.name} · ${scopeLabel(asset.source)}` : `计划需求（待关联资产） · ${binding.asset_id}`}</p>
                                                    <p className="text-[0.6875rem] text-text-muted">{binding.scene_ids.length} 个场景 · {binding.shot_ids.length} 个镜头 · {asset ? statusLabel(binding.status) : "待关联资产"}</p>
                                                </div>
                                                {asset && project[group.type === "scene" ? "scenes" : group.type === "prop" ? "props" : "characters"]?.some((item: { id: string }) => item.id === asset.id) &&
                                                    <button type="button" className="shrink-0 text-[0.6875rem] text-primary hover:underline" onClick={() => onOpenAsset(group.type, asset.id)}>打开资产</button>}
                                            </div>
                                            {sourceIds.length > 0 && <select aria-label={`为计划${group.label}需求选择资产`}
                                                value={asset?.id ?? ""} disabled={bindingPersonId !== null}
                                                onChange={event => void onBindPlanAsset(group.type as "scene" | "prop", sourceIds, event.target.value)}
                                                className="mt-1.5 w-full rounded border border-glass-border bg-surface px-2 py-1 text-xs text-foreground">
                                                {!asset && <option value="">选择{group.label}资产</option>}
                                                {assetsForType(group.type).map(item => <option key={item.id} value={item.id}>{item.name} · {scopeLabel(item.source)}</option>)}
                                            </select>}
                                        </div>
                                    );
                                })}
                                {group.type === "scene" && unboundScenes.map(scene => (
                                    <div key={`unbound-scene:${scene.scene_id}`} className="rounded border border-glass-border/70 px-2 py-1.5">
                                        <p className="text-xs text-foreground">计划场景 · {scene.scene_ref || scene.location || scene.scene_id}</p>
                                        <p className="text-[0.6875rem] text-text-secondary">关联场景资产 · 待关联</p>
                                        <p className="text-[0.6875rem] text-text-muted">
                                            {context?.shots.filter(shot => shot.scene_id === scene.scene_id && !shot.scene_asset_id).length ?? 0} 个镜头 · 场景资产待关联
                                        </p>
                                        <select aria-label={`为计划场景 ${scene.scene_ref || scene.location || scene.scene_id} 选择资产`}
                                            value="" disabled={bindingPersonId !== null}
                                            onChange={event => void onBindPlanScene(scene.scene_id, event.target.value)}
                                            className="mt-1.5 w-full rounded border border-glass-border bg-surface px-2 py-1 text-xs text-foreground">
                                            <option value="">选择场景资产</option>
                                            {assetsForType("scene").map(item => <option key={item.id} value={item.id}>{item.name} · {scopeLabel(item.source)}</option>)}
                                        </select>
                                    </div>
                                ))}
                                {group.type === "character" && Array.from(people.entries()).map(([personId, requirement]) => {
                                    const selectedId = project.episode_person_asset_bindings?.[personId] ??
                                        (requirement.assetIds.length === 1 ? requirement.assetIds[0] : "");
                                    const selectedAsset = selectedId ? getAsset("character", selectedId) : null;
                                    return <div key={`person:${personId}`} className="rounded border border-glass-border/70 px-2 py-1.5">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="text-xs text-foreground">计划人物 · {requirement.label}</p>
                                            {selectedAsset && project.characters.some((asset: { id: string }) => asset.id === selectedId) && (
                                                <button type="button" className="shrink-0 text-[0.6875rem] text-primary hover:underline" onClick={() => onOpenAsset("character", selectedId)}>打开资产</button>
                                            )}
                                        </div>
                                        <p className="text-[0.6875rem] text-text-secondary">关联角色资产 · {selectedAsset ? `${selectedAsset.name} · ${scopeLabel(selectedAsset.source)}` : "待关联"}</p>
                                        <p className="text-[0.6875rem] text-text-muted">{requirement.sceneIds.length} 个场景 · {requirement.shotIds.length} 个镜头 · {requirement.lookCount} 条造型需求 · {selectedAsset ? (project.episode_person_asset_bindings?.[personId] ? "手动关联" : "按人物身份关联") : "待关联角色资产"}</p>
                                        <select aria-label={`为计划人物 ${requirement.label} 选择角色资产`}
                                            value={selectedId}
                                            disabled={bindingPersonId !== null}
                                            onChange={(event) => void onBindPersonAsset(personId, event.target.value || null)}
                                            className="mt-1.5 w-full rounded border border-glass-border bg-surface px-2 py-1 text-xs text-foreground">
                                            <option value="" disabled={Boolean(selectedId)}>选择角色资产</option>
                                            {assetsForType("character").map((asset) => (
                                                <option key={asset.id} value={asset.id}>{asset.name} · {scopeLabel(asset.source)}</option>
                                            ))}
                                        </select>
                                    </div>;
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}

function CharacterDetailModal({ asset, type, onClose, onUpdateDescription, onUpdateAttributes, onRename, onGenerate, isGenerating, stylePrompt = "", styleNegativePrompt = "", onGenerateVideo, onDeleteVideo, isGeneratingVideo, planEntries = [] }: any) {
    const tv = useTranslations("vault");
    const [description, setDescription] = useState(asset.description);
    const [isEditing, setIsEditing] = useState(false);
    const [descriptionSaved, setDescriptionSaved] = useState(true);
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const selectionQueue = useRef<Promise<void>>(Promise.resolve());
    const selectionVersion = useRef(0);
    const savedSceneDesign = asset.asset_design?.design_draft || {};
    const savedWorkspace = type === "scene" ? savedSceneDesign.prompt_workspace : undefined;
    const [imagePrompt, setImagePrompt] = useState(savedWorkspace?.design?.prompt ?? (asset.image_prompt || asset.description || ""));
    const [scenePromptTab, setScenePromptTab] = useState<"design" | "ai">(savedWorkspace?.active_source === "ai" ? "ai" : "design");
    const [showSceneSettings, setShowSceneSettings] = useState(false);
    const inheritedSceneLighting = [asset.time_of_day, asset.lighting_mood].filter(Boolean).join("；");
    const [sceneDesign, setSceneDesign] = useState(() => ({
        visual_notes: String(savedSceneDesign.visual_notes || asset.description || ""),
        style: typeof savedSceneDesign.style === "string" ? savedSceneDesign.style : stylePrompt,
        ambient_lighting: typeof savedSceneDesign.ambient_lighting === "string" ? savedSceneDesign.ambient_lighting : inheritedSceneLighting,
        local_target: String(savedSceneDesign.local_lighting?.target || ""),
        local_effect: String(savedSceneDesign.local_lighting?.effect || ""),
        reference_viewpoint: String(savedSceneDesign.reference_viewpoint || ""),
        reference_framing: String(savedSceneDesign.reference_framing || ""),
        prompt_layers: (savedSceneDesign.prompt_layers || {}) as ScenePromptLayers,
        visual_constraints: {
            key_light_direction: String(savedSceneDesign.visual_constraints?.key_light_direction || "unspecified"),
            forbidden_light_directions: Array.isArray(savedSceneDesign.visual_constraints?.forbidden_light_directions) ? savedSceneDesign.visual_constraints.forbidden_light_directions : [],
            visible_face_limit: savedSceneDesign.visual_constraints?.visible_face_limit ?? "",
            secondary_people_view: String(savedSceneDesign.visual_constraints?.secondary_people_view || ""),
        },
    }));
    const [sceneDesignNeedsApply, setSceneDesignNeedsApply] = useState(() =>
        savedWorkspace ? Boolean(savedWorkspace.settings_pending) : type === "scene" && !String(asset.image_prompt || "").includes("【场景结构化设置】") && Boolean(
            (typeof savedSceneDesign.style === "string" ? savedSceneDesign.style : stylePrompt)
            || (typeof savedSceneDesign.ambient_lighting === "string" ? savedSceneDesign.ambient_lighting : inheritedSceneLighting)
            || savedSceneDesign.local_lighting?.effect
            || savedSceneDesign.reference_viewpoint
            || savedSceneDesign.reference_framing
            || compileScenePromptLayers(savedSceneDesign.prompt_layers || {})
            || savedSceneDesign.visual_constraints?.key_light_direction
            || savedSceneDesign.visual_constraints?.forbidden_light_directions?.length
            || savedSceneDesign.visual_constraints?.visible_face_limit !== undefined,
        ));
    const [sceneDesignSaving, setSceneDesignSaving] = useState(false);
    const [promptModels, setPromptModels] = useState<ChatModel[]>([]);
    const [promptModel, setPromptModel] = useState("");
    const [optimizingPrompt, setOptimizingPrompt] = useState(false);
    const [optimizedPrompt, setOptimizedPrompt] = useState(type === "scene" ? savedWorkspace?.ai?.prompt || "" : "");
    const [promptError, setPromptError] = useState("");
    const [pendingPromptReview, setPendingPromptReview] = useState<{
        source: string; request: Record<string, unknown>; messages: VideoPolishMessages;
        reviewToken: string; formatNote: string;
    } | null>(null);
    const [imageGenerationMode, setImageGenerationMode] = useState<"text" | "reference">(savedWorkspace?.design?.mode || "text");
    const [promptReferences, setPromptReferences] = useState<AssetLibraryReference[]>(savedWorkspace?.design?.references || []);
    const [aiGenerationMode, setAiGenerationMode] = useState<"text" | "reference">(savedWorkspace?.ai?.mode || "text");
    const [aiReferences, setAiReferences] = useState<AssetLibraryReference[]>(savedWorkspace?.ai?.references || []);
    const usingSceneAi = type === "scene" && scenePromptTab === "ai";
    const visibleImagePrompt = usingSceneAi ? optimizedPrompt : imagePrompt;
    const setVisibleImagePrompt = usingSceneAi ? setOptimizedPrompt : setImagePrompt;
    const visibleReferences = usingSceneAi ? aiReferences : promptReferences;
    const setVisibleReferences = usingSceneAi ? setAiReferences : setPromptReferences;
    const visibleGenerationMode = usingSceneAi ? aiGenerationMode : imageGenerationMode;
    const setVisibleGenerationMode = usingSceneAi ? setAiGenerationMode : setImageGenerationMode;
    const currentSceneSnapshot = { sceneDesign, imagePrompt, optimizedPrompt, imageGenerationMode,
        aiGenerationMode, promptReferences, aiReferences, sceneDesignNeedsApply };
    const savedSceneSnapshot = useRef(currentSceneSnapshot);
    const [hasSavedSceneDesign, setHasSavedSceneDesign] = useState(Boolean(savedWorkspace || savedSceneDesign.visual_notes));
    const [savedSceneSource, setSavedSceneSource] = useState<"design" | "ai">(savedWorkspace?.active_source === "ai" ? "ai" : "design");
    const sceneHasChanges = JSON.stringify(currentSceneSnapshot) !== JSON.stringify(savedSceneSnapshot.current);
    const restoreSavedSceneDesign = () => {
        const snapshot = savedSceneSnapshot.current;
        setSceneDesign(snapshot.sceneDesign);
        setImagePrompt(snapshot.imagePrompt);
        setOptimizedPrompt(snapshot.optimizedPrompt);
        setImageGenerationMode(snapshot.imageGenerationMode);
        setAiGenerationMode(snapshot.aiGenerationMode);
        setPromptReferences(snapshot.promptReferences);
        setAiReferences(snapshot.aiReferences);
        setSceneDesignNeedsApply(snapshot.sceneDesignNeedsApply);
        setScenePromptTab("design");
        setPendingPromptReview(null);
        setMention(null);
        setPromptError("");
    };
    const [assetIndex, setAssetIndex] = useState<any[]>([]);
    const assetIndexRevision = JSON.stringify(
        [currentProject?.characters, currentProject?.scenes, currentProject?.props].map((items) =>
            Array.isArray(items) ? items.map((item: any) => [
                item?.id,
                item?.updated_at,
                item?.image_asset?.variants?.map((variant: any) => [variant.id, variant.display_name]),
                item?.reference_sheet?.image_variants?.map((variant: any) => variant.id),
                item?.full_body_asset?.variants?.map((variant: any) => variant.id),
                item?.three_view_asset?.variants?.map((variant: any) => variant.id),
                item?.headshot_asset?.variants?.map((variant: any) => variant.id),
            ]) : [],
        ),
    );
    const [mention, setMention] = useState<ReferenceSuggestion | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);

    // Style Controls
    const [negativePrompt, setNegativePrompt] = useState(styleNegativePrompt || DEFAULT_CHARACTER_NEGATIVE_PROMPT);
    const [pendingImageReview, setPendingImageReview] = useState<AssetImageReviewRequest | null>(null);
    const [pendingPromptSource, setPendingPromptSource] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Video Controls
    const [activeTab, setActiveTab] = useState<"image" | "video" | "lighting" | "camera">("image");
    const [videoPrompt, setVideoPrompt] = useState(asset.video_prompt || "");
    const sceneImageSources = useMemo<SceneImageSource[]>(() => (asset.image_asset?.variants || [])
        .filter((variant: any) => variant.id && variant.url)
        .map((variant: any, index: number) => ({
            key: variant.id, variantId: variant.id, label: `场景图片 · ${index + 1}${variant.scene_tool ? ` · ${variant.scene_tool.kind === "lighting" ? "光影" : "镜头"}` : ""}`, url: getAssetUrl(variant.url), tool: variant.scene_tool, sourceVariantId: variant.scene_tool_source_variant_id,
        })), [asset.image_asset]);

    // Sync local state if asset changes
    useEffect(() => {
        setDescription(asset.description);
        setMention(null);
        if (asset.video_prompt) setVideoPrompt(asset.video_prompt);
        else if (!videoPrompt) {
            setVideoPrompt(buildCharacterVideoPrompt(asset.name, asset.description));
        }
    }, [asset]);

    useEffect(() => {
        let active = true;
        void agentRequest<{ models: ChatModel[] }>("/models").then(({ models }) => {
            if (!active) return;
            const available = models.filter(model => model.agent_capability !== "h3_prompt_optimization");
            setPromptModels(available);
            setPromptModel(current => current || available[0]?.api_model_id || "");
        }).catch(() => { if (active) setPromptModels([]); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!currentProject?.id) {
            setAssetIndex([]);
            return;
        }
        let active = true;
        void api.getAssetReferenceIndex(currentProject.id)
            .then((index) => {
                if (active) setAssetIndex(index.assets.filter((entry) => entry.variants?.length));
            })
            .catch(() => undefined);
        return () => { active = false; };
    }, [currentProject?.id, assetIndexRevision, asset.id]);

    const referenceCandidates = useMemo<ReferenceCandidate[]>(() => {
        const labels = new Set<string>();
        return assetIndex.flatMap((entry) => (entry.variants || []).map((variant: any, index: number) => {
            if (!variant?.id) return null;
            const variantLabel = variant.display_name || variant.reference_view_role || variant.reference_distance || `未命名素材 ${index + 1}`;
            const isActive = entry.selected_variant_id === variant.id;
            const baseLabel = entry.variants.length > 1 ? `${entry.name} · ${variantLabel}` : entry.name;
            let label = baseLabel;
            let suffix = 2;
            while (labels.has(label)) label = `${baseLabel} ${suffix++}`;
            labels.add(label);
            return {
                label,
                previewUrl: getAssetUrl(variant.url),
                sourceLabel: entry.source_scope,
                description: entry.description,
                variantLabel,
                isActive,
                reference: { asset_type: entry.asset_type, asset_id: entry.asset_id, variant_id: variant.id },
            };
        }).filter(Boolean) as ReferenceCandidate[]);
    }, [assetIndex]);

    const matchingReferenceCandidates = searchReferenceCandidates(referenceCandidates, mention?.query ?? "")
        .sort((left, right) => Number(Boolean(right.isActive)) - Number(Boolean(left.isActive)));
    const lightingReferences = useMemo<LightingReference[]>(() => referenceCandidates.flatMap((candidate) => candidate.reference && candidate.previewUrl ? [{ key: `${candidate.reference.asset_type}:${candidate.reference.asset_id}:${candidate.reference.variant_id}`, label: candidate.label, url: candidate.previewUrl, reference: candidate.reference }] : []), [referenceCandidates]);

    const handleMentionKeyDown = (event: KeyboardEvent) => {
        if (!mention) return false;
        if (event.key === "Escape") { setMention(null); return true; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setMentionIndex(current => (current + (event.key === "ArrowDown" ? 1 : -1) + matchingReferenceCandidates.length) % Math.max(matchingReferenceCandidates.length, 1));
            return true;
        }
        if (event.key === "Enter" && matchingReferenceCandidates.length) {
            event.preventDefault();
            mention.choose(matchingReferenceCandidates[Math.min(mentionIndex, matchingReferenceCandidates.length - 1)]);
            setMention(null);
            return true;
        }
        return false;
    };

    // Sync negative prompt if style changes
    useEffect(() => {
        if (styleNegativePrompt && (!negativePrompt || negativePrompt.includes("low quality"))) {
            setNegativePrompt(styleNegativePrompt);
        }
    }, [styleNegativePrompt]);

    const handleSave = async () => {
        await onUpdateDescription(description);
        setDescriptionSaved(true);
        if (type === "scene") {
            setSceneDesign(current => ({ ...current, visual_notes: description }));
            setSceneDesignNeedsApply(true);
        }
        setIsEditing(false);
    };

    const handleSelectVariant = (variantId: string) => {
        if (!currentProject) return;
        const version = ++selectionVersion.current;
        const operation = selectionQueue.current.then(async () => {
            const updatedProject = await api.selectAssetVariant(currentProject.id, asset.id, type, variantId);
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
            const updatedProject = await api.deleteAssetVariant(currentProject.id, asset.id, type, variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete variant:", error);
            throw error;
        }
    };

    const handleRenameVariant = async (variantId: string, displayName: string) => {
        if (!currentProject) return;
        const updatedProject = await api.updateAssetVariantMetadata(
            currentProject.id, asset.id, type, variantId, undefined, undefined, displayName,
        );
        updateProject(currentProject.id, updatedProject);
    };

    const buildSceneDesignText = () => {
        const visualConstraints = sceneDesign.visual_constraints;
        return [
            sceneDesign.visual_notes && `场景空间：${sceneDesign.visual_notes}`,
            sceneDesign.style && `场景风格：${sceneDesign.style}`,
            compileScenePromptLayers(sceneDesign.prompt_layers),
            sceneDesign.local_effect && sceneDesign.local_target && `局部光照：${sceneDesign.local_target}，${sceneDesign.local_effect}`,
            sceneDesign.ambient_lighting && `环境光：${sceneDesign.ambient_lighting}`,
            sceneDesign.reference_viewpoint && `参考图视角：${sceneDesign.reference_viewpoint}`,
            sceneDesign.reference_framing && `参考图构图：${sceneDesign.reference_framing}`,
            visualConstraints.key_light_direction !== "unspecified" && `主光方向：${({ front: "正面", back: "背面", side: "侧面", top: "顶部", bottom: "底部", mixed: "混合" } as Record<string, string>)[visualConstraints.key_light_direction]}`,
            visualConstraints.forbidden_light_directions.length > 0 && `禁止光线方向：${visualConstraints.forbidden_light_directions.map((item: string) => ({ front: "正面光", back: "背光", side: "侧面光", top: "顶部光", bottom: "底部光", mixed: "混合光" } as Record<string, string>)[item] || item).join("、")}`,
            visualConstraints.visible_face_limit !== "" && `可见人脸上限：${visualConstraints.visible_face_limit} 张。`,
            visualConstraints.secondary_people_view && `其他人物呈现：${visualConstraints.secondary_people_view}`,
        ].filter(Boolean).join("\n");
    };

    const promptRefineRequest = {
        model: promptModel,
        project_id: currentProject?.id || "",
        asset_id: asset.id,
        asset_type: type,
        asset_name: asset.name,
        description,
        current_prompt: imagePrompt,
        style: type === "scene" ? buildSceneDesignText() : "",
        plan_context: [],
    };
    const promptRefineSource = JSON.stringify(promptRefineRequest);
    const promptRefineSourceRef = useRef(promptRefineSource);
    promptRefineSourceRef.current = promptRefineSource;
    useEffect(() => {
        setPendingPromptReview(null);
        if (type !== "scene") setOptimizedPrompt("");
    }, [promptRefineSource, type]);

    const handleOptimizePrompt = async () => {
        if (!promptModel || optimizingPrompt) return;
        if (type === "scene" && sceneDesignNeedsApply) {
            toast.warning("请先检查并应用场景结构化设置到可见提示词，再进行 AI 优化。");
            return;
        }
        setOptimizingPrompt(true);
        setPromptError("");
        if (type !== "scene") setOptimizedPrompt("");
        setPendingPromptReview(null);
        try {
            const source = promptRefineSource;
            const preview = await agentRequest<{ messages: VideoPolishMessages; review_token: string; format_note: string }>(
                "/asset-image-prompt/refine/preview", "POST", promptRefineRequest);
            if (promptRefineSourceRef.current === source) setPendingPromptReview({
                source, request: promptRefineRequest, messages: preview.messages,
                reviewToken: preview.review_token, formatNote: preview.format_note,
            });
        } catch (error) {
            setPromptError(extractErrorDetail(error));
        } finally {
            setOptimizingPrompt(false);
        }
    };

    const confirmPromptRefine = async () => {
        const review = pendingPromptReview;
        if (!review) return;
        if (review.source !== promptRefineSourceRef.current) {
            setPendingPromptReview(null);
            setPromptError("资产输入已变化，请重新预览。");
            return;
        }
        setOptimizingPrompt(true);
        setPromptError("");
        try {
            const result = await agentRequest<{ prompt: string }>("/asset-image-prompt/refine", "POST", {
                ...review.request, reviewed_messages: review.messages, review_token: review.reviewToken,
            });
            setPendingPromptReview(null);
            if (review.source === promptRefineSourceRef.current) {
                setOptimizedPrompt(result.prompt);
                if (type === "scene") {
                    setAiReferences([...promptReferences]);
                    setAiGenerationMode(imageGenerationMode);
                    setScenePromptTab("ai");
                }
            }
        } catch (error) {
            setPromptError(extractErrorDetail(error));
        } finally {
            setOptimizingPrompt(false);
        }
    };

    const handleGenerateClick = (batchSize: number) => {
        if (type === "scene" && !usingSceneAi && sceneDesignNeedsApply) {
            toast.warning("场景设置已修改；请先应用到可见提示词，或选择保留当前提示词。");
            return;
        }
        if (visibleGenerationMode === "reference" && visibleReferences.length === 0) {
            toast.warning(tv("referenceModeRequiresExplicit"));
            return;
        }
        if (visibleGenerationMode === "text" && visibleReferences.length > 0) {
            toast.warning(tv("referenceModeSelectExplicitly"));
            return;
        }
        if (!currentProject?.id || !visibleImagePrompt.trim()) {
            toast.warning("Review a non-empty image prompt before generating.");
            return;
        }
        setPendingPromptSource(type === "scene" ? usingSceneAi ? "AI 优化" : "场景设计" : "");
        setPendingImageReview({
            asset_id: asset.id,
            asset_type: type,
            generation_type: "all",
            prompt: visibleImagePrompt,
            negative_prompt: negativePrompt,
            batch_size: batchSize,
            model_name: currentProject.series_id ? undefined : resolveAssetGenerationModel(currentProject.model_settings?.t2i_model),
            references: visibleReferences,
            image_generation_mode: visibleGenerationMode,
            apply_style: false,
            preserve_prompt: true,
        });
    };

    const updateSceneDesign = (key: keyof typeof sceneDesign, value: string) => {
        setSceneDesign(current => ({ ...current, [key]: value }));
        setSceneDesignNeedsApply(true);
    };

    const updateVisualConstraint = (key: keyof typeof sceneDesign.visual_constraints, value: string | string[] | number | "") => {
        setSceneDesign(current => ({
            ...current,
            visual_constraints: { ...current.visual_constraints, [key]: value },
        }));
        setSceneDesignNeedsApply(true);
    };

    const applySceneDesign = () => {
        if (sceneLightDirectionConflict(sceneDesign.prompt_layers, sceneDesign.visual_constraints.forbidden_light_directions)) {
            setPromptError("所选光源方向与禁止方向冲突，请先调整光影设置或约束。");
            return;
        }
        setPromptError("");
        const text = buildSceneDesignText();
        const block = text ? `【场景结构化设置】\n${text}\n【/场景结构化设置】` : "";
        setImagePrompt((current: string) => {
            const withoutPrevious = current.replace(/\n?【场景结构化设置】[\s\S]*?【\/场景结构化设置】/g, "").trim();
            const base = withoutPrevious === sceneDesign.visual_notes.trim() ? "" : withoutPrevious;
            return [base, block].filter(Boolean).join("\n\n");
        });
        setSceneDesignNeedsApply(false);
    };

    const saveSceneDesign = async () => {
        if (sceneDesignSaving || optimizingPrompt) return;
        if (!visibleImagePrompt.trim() || !sceneDesign.visual_notes.trim()) {
            setPromptError(usingSceneAi ? "请先提交并检查 AI 优化结果，再保存使用。" : "请先填写具体的场景设计，再保存使用。");
            return;
        }
        const snapshot = currentSceneSnapshot;
        const source = scenePromptTab;
        setSceneDesignSaving(true);
        setPromptError("");
        try {
            await onUpdateAttributes({ asset_design: {
                visual_notes: sceneDesign.visual_notes.trim(),
                style: sceneDesign.style.trim(),
                ambient_lighting: sceneDesign.ambient_lighting.trim(),
                local_lighting: { target: sceneDesign.local_target.trim(), effect: sceneDesign.local_effect.trim() },
                reference_viewpoint: sceneDesign.reference_viewpoint.trim(),
                reference_framing: sceneDesign.reference_framing.trim(),
                prompt_layers: sceneDesign.prompt_layers,
                visual_constraints: {
                    key_light_direction: sceneDesign.visual_constraints.key_light_direction,
                    forbidden_light_directions: sceneDesign.visual_constraints.forbidden_light_directions,
                    visible_face_limit: sceneDesign.visual_constraints.visible_face_limit === "" ? null : Number(sceneDesign.visual_constraints.visible_face_limit),
                    secondary_people_view: sceneDesign.visual_constraints.secondary_people_view.trim(),
                },
                prompt_workspace: {
                    active_source: source,
                    settings_pending: sceneDesignNeedsApply,
                    design: { prompt: imagePrompt, mode: imageGenerationMode, references: promptReferences },
                    ai: { prompt: optimizedPrompt, mode: aiGenerationMode, references: aiReferences },
                },
                confirmed: true,
            } });
            savedSceneSnapshot.current = snapshot;
            setHasSavedSceneDesign(true);
            setSavedSceneSource(source);
            toast.success(`已保存并使用${source === "ai" ? " AI 优化" : "场景设计"}`);
        } catch (error) {
            setPromptError(extractErrorDetail(error));
            toast.error("场景设计保存失败", { body: extractErrorDetail(error) });
        } finally {
            setSceneDesignSaving(false);
        }
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface border border-glass-border w-full h-full flex flex-col overflow-hidden shadow-lg"
            >
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-glass-border flex justify-between items-center bg-surface">
                        <AssetNameEditor name={asset.name} onRename={onRename} className="text-xl font-bold" />
                        <button aria-label="关闭工作台" onClick={onClose} className="min-h-11 min-w-11 p-2 hover:bg-hover-bg rounded-full text-text-secondary hover:text-foreground">
                            <X size={24} />
                        </button>
                    </div>

                    {/* Tab Switcher */}
                    <div className="flex border-b border-glass-border bg-surface">
                        <button
                            onClick={() => setActiveTab("image")}
                            className={`flex-1 p-3 text-sm font-bold transition-colors ${activeTab === "image" ? "text-foreground border-b-2 border-primary bg-glass" : "text-text-muted hover:text-text-secondary"}`}
                        >
                            Image Reference
                        </button>
                        <button
                            onClick={() => setActiveTab("video")}
                            className={`flex-1 p-3 text-sm font-bold transition-colors ${activeTab === "video" ? "text-foreground border-b-2 border-primary bg-glass" : "text-text-muted hover:text-text-secondary"}`}
                        >
                            Video Reference
                        </button>
                        {type === "scene" && <>
                            <button onClick={() => setActiveTab("lighting")} className={`flex-1 p-3 text-sm font-bold transition-colors ${activeTab === "lighting" ? "text-foreground border-b-2 border-primary bg-glass" : "text-text-muted hover:text-text-secondary"}`}>光影</button>
                            <button onClick={() => setActiveTab("camera")} className={`flex-1 p-3 text-sm font-bold transition-colors ${activeTab === "camera" ? "text-foreground border-b-2 border-primary bg-glass" : "text-text-muted hover:text-text-secondary"}`}>镜头</button>
                        </>}
                    </div>

                {activeTab === "lighting" || activeTab === "camera" ? <SceneImageTools kind={activeTab} sources={sceneImageSources} sceneAssetId={asset.id} lightingReferences={lightingReferences} busy={isGenerating} onGenerate={(source, params, compiledPrompt, lightReference) => {
                            const sourceReference: AssetLibraryReference = { asset_type: "scene", asset_id: asset.id, variant_id: source.variantId };
                            const references = [sourceReference];
                            if (lightReference && !(lightReference.asset_type === sourceReference.asset_type && lightReference.asset_id === sourceReference.asset_id && lightReference.variant_id === sourceReference.variant_id)) references.push(lightReference);
                            setPendingImageReview({
                                asset_id: asset.id, asset_type: "scene", generation_type: "all",
                                prompt: compiledPrompt, negative_prompt: negativePrompt,
                                batch_size: 1,
                                model_name: currentProject?.series_id ? undefined : resolveAssetGenerationModel(currentProject?.model_settings?.t2i_model),
                                references, image_generation_mode: "reference",
                                apply_style: false, preserve_prompt: true, scene_tool: params,
                            });
                        }} /> : <AssetWorkbenchLayout controls={<div className="flex min-w-0 flex-col">
                    <EpisodeAssetPlanPanel entries={planEntries} onUse={(text) => setImagePrompt((previous: string) => `${previous.trim()}\n${text}`.trim())} />

                    {/* Content */}
                    <div className="space-y-6 p-4 sm:p-5">
                        {/* Description */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-sm font-bold text-text-secondary uppercase">{type === "scene" ? "场景描述 · 设计依据" : "Description"}</label>
                                {type !== "scene" && !isEditing && (
                                    <button onClick={() => setIsEditing(true)} className="text-xs text-primary hover:underline">
                                        Edit
                                    </button>
                                )}
                            </div>
                            {isEditing ? (
                                <div className="space-y-2">
                                    <textarea
                                        value={description}
                                        onChange={(e) => { setDescription(e.target.value); setDescriptionSaved(false); }}
                                        className="w-full h-32 bg-input-bg border border-glass-border rounded-lg p-3 text-sm text-text-secondary resize-none focus:border-primary focus:outline-none"
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button onClick={() => { setIsEditing(false); setDescription(asset.description); }} className="px-3 py-1.5 text-xs text-text-secondary hover:text-foreground">Cancel</button>
                                        <button onClick={() => void handleSave()} className="px-3 py-1.5 bg-primary text-white text-xs rounded hover:bg-primary/90">Save Description</button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-text-secondary leading-relaxed bg-glass p-3 rounded-lg border border-transparent hover:border-glass-border transition-colors">
                                    {asset.description}
                                </p>
                            )}
                        </div>

                        {type === "scene" && activeTab === "image" && <div className="flex items-center gap-2 border-b border-glass-border">
                            <div className="flex flex-1" role="tablist" aria-label="场景提示词来源">
                            {(["design", "ai"] as const).map(tab => <button key={tab} type="button" role="tab"
                                id={`scene-tab-${tab}`} aria-controls={`scene-prompt-${tab}`} tabIndex={scenePromptTab === tab ? 0 : -1}
                                disabled={sceneDesignSaving || optimizingPrompt} aria-selected={scenePromptTab === tab} onClick={() => { setScenePromptTab(tab); setMention(null); }}
                                onKeyDown={event => {
                                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                                    event.preventDefault();
                                    const next = event.key === "Home" ? "design" : event.key === "End" ? "ai" : tab === "design" ? "ai" : "design";
                                    setScenePromptTab(next);
                                    setMention(null);
                                    document.getElementById(`scene-tab-${next}`)?.focus();
                                }}
                                className={`min-h-11 flex-1 border-b-2 px-3 text-sm ${scenePromptTab === tab ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-foreground"}`}>
                                {tab === "design" ? "场景设计" : "AI 优化"}
                            </button>)}
                            </div>
                        </div>}
                        {type === "scene" && activeTab === "image" && scenePromptTab === "design" && <button type="button"
                            aria-expanded={showSceneSettings} onClick={() => setShowSceneSettings(value => !value)}
                            className="min-h-11 w-full rounded-lg border border-glass-border px-3 text-left text-sm text-foreground">
                            {showSceneSettings ? "收起基础面板" : "基础面板 · 空间、风格、光影与构图"}
                        </button>}
                        {type === "scene" && activeTab === "image" && scenePromptTab === "design" && showSceneSettings && (
                            <section className="space-y-3 rounded-lg border border-glass-border bg-glass p-4" aria-label="场景结构化设置">
                                <label className="block text-xs text-text-secondary">场景描述
                                    <textarea aria-label="场景空间与固定外观" value={sceneDesign.visual_notes} onChange={event => updateSceneDesign("visual_notes", event.target.value)} className="mt-1 w-full rounded border border-glass-border bg-input-bg p-2 text-sm text-foreground" rows={3} />
                                </label>
                                <label className="block text-xs text-text-secondary">风格
                                    <textarea aria-label="场景风格" value={sceneDesign.style} onChange={event => updateSceneDesign("style", event.target.value)} className="mt-1 w-full rounded border border-glass-border bg-input-bg p-2 text-sm text-foreground" rows={2} />
                                </label>
                                <ScenePromptLayersPanel value={sceneDesign.prompt_layers} onChange={layers => {
                                    setSceneDesign(current => ({ ...current, prompt_layers: layers,
                                        visual_constraints: { ...current.visual_constraints,
                                            key_light_direction: layers.lighting?.direction || layers.lighting?.angles ? "unspecified" : current.visual_constraints.key_light_direction },
                                    }));
                                    setSceneDesignNeedsApply(true);
                                }} />
                                <details className="rounded border border-glass-border p-2">
                                    <summary className="min-h-11 cursor-pointer text-xs text-text-secondary">补充描述与旧版设置</summary>
                                    <label className="block text-xs text-text-secondary">环境光补充
                                        <textarea aria-label="场景环境光" value={sceneDesign.ambient_lighting} onChange={event => updateSceneDesign("ambient_lighting", event.target.value)} className="mt-1 w-full rounded border border-glass-border bg-input-bg p-2 text-sm text-foreground" rows={2} />
                                    </label>
                                    <div className="grid gap-2 md:grid-cols-2">
                                        <label className="block text-xs text-text-secondary">视角
                                            <input aria-label="场景参考图视角" value={sceneDesign.reference_viewpoint} onChange={event => updateSceneDesign("reference_viewpoint", event.target.value)} className="mt-1 w-full rounded border border-glass-border bg-input-bg p-2 text-sm text-foreground" />
                                        </label>
                                        <label className="block text-xs text-text-secondary">构图与空间层次
                                            <input aria-label="场景参考图构图" value={sceneDesign.reference_framing} onChange={event => updateSceneDesign("reference_framing", event.target.value)} className="mt-1 w-full rounded border border-glass-border bg-input-bg p-2 text-sm text-foreground" />
                                        </label>
                                    </div>
                                </details>
                                <div className="rounded border border-glass-border/70 bg-input-bg/40 p-3 space-y-2">
                                    <p className="text-xs font-semibold text-foreground">可执行一致性约束</p>
                                    <div className="grid gap-2 md:grid-cols-2">
                                        {sceneDesign.visual_constraints.key_light_direction !== "unspecified" && <label className="block text-xs text-text-secondary">旧版主光方向
                                            <select aria-label="主光方向" value={sceneDesign.visual_constraints.key_light_direction} onChange={event => updateVisualConstraint("key_light_direction", event.target.value)} className="mt-1 w-full rounded border border-glass-border bg-input-bg p-2 text-sm text-foreground">
                                                <option value="unspecified">未指定</option><option value="front">正面光</option><option value="back">背面光</option><option value="side">侧面光</option><option value="top">顶部光</option><option value="bottom">底部光</option><option value="mixed">混合光</option>
                                            </select>
                                        </label>}
                                        <label className="block text-xs text-text-secondary">可见人脸上限
                                            <input aria-label="可见人脸上限" type="number" min={0} max={50} value={sceneDesign.visual_constraints.visible_face_limit} onChange={event => updateVisualConstraint("visible_face_limit", event.target.value === "" ? "" : Number(event.target.value))} className="mt-1 w-full rounded border border-glass-border bg-input-bg p-2 text-sm text-foreground" placeholder="例如：3" />
                                        </label>
                                    </div>
                                    <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
                                        {[["front", "禁止正面光"], ["back", "禁止背光"], ["top", "禁止顶部光"], ["bottom", "禁止底部光"]].map(([value, label]) => <label key={value} className="inline-flex items-center gap-1"><input type="checkbox" checked={sceneDesign.visual_constraints.forbidden_light_directions.includes(value)} onChange={event => updateVisualConstraint("forbidden_light_directions", event.target.checked ? [...sceneDesign.visual_constraints.forbidden_light_directions, value] : sceneDesign.visual_constraints.forbidden_light_directions.filter((item: string) => item !== value))} />{label}</label>)}
                                    </div>
                                    <label className="block text-xs text-text-secondary">其他人物呈现方式
                                        <input aria-label="其他人物呈现方式" value={sceneDesign.visual_constraints.secondary_people_view} onChange={event => updateVisualConstraint("secondary_people_view", event.target.value)} className="mt-1 w-full rounded border border-glass-border bg-input-bg p-2 text-sm text-foreground" placeholder="例如：其他人物保持侧身或远景" />
                                    </label>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button type="button" onClick={applySceneDesign} className="min-h-11 rounded bg-primary px-3 text-sm text-white">应用到图片提示词</button>
                                </div>
                            </section>
                        )}

                        {/* Image generation description. Selecting/uploading a
                            variant only makes it available; @ in this editor
                            is the explicit binding sent to the provider. */}
                        {activeTab === "image" && (
                            <div className="space-y-2" role={type === "scene" ? "tabpanel" : undefined}
                                id={type === "scene" ? `scene-prompt-${scenePromptTab}` : undefined}
                                aria-labelledby={type === "scene" ? `scene-tab-${scenePromptTab}` : undefined}>
                                {type === "scene" && !usingSceneAi && sceneDesignNeedsApply && <div role="status" className="text-xs text-primary">
                                    基础面板有未应用的设置。
                                    <button type="button" className="min-h-11 px-2 underline" onClick={() => setShowSceneSettings(true)}>打开基础面板</button>
                                    <button type="button" className="min-h-11 px-2 underline" onClick={() => setSceneDesignNeedsApply(false)}>保留当前提示词</button>
                                </div>}
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <label className="text-sm font-bold text-text-secondary">{type === "scene" ? `本次生成使用：${usingSceneAi ? "AI 优化" : "场景设计"}` : tv("imagePromptLabel")}</label>
                                    <div className="flex items-center gap-1 rounded-md border border-glass-border bg-black/20 p-1" role="group" aria-label="Image generation mode">
                                        {(["text", "reference"] as const).map((mode) => (
                                            <button
                                                key={mode}
                                                type="button"
                                                disabled={sceneDesignSaving || (usingSceneAi && optimizingPrompt)}
                                                aria-pressed={visibleGenerationMode === mode}
                                                onClick={() => setVisibleGenerationMode(mode)}
                                                className={`rounded px-2 py-1 text-[0.6875rem] ${visibleGenerationMode === mode ? "bg-primary/15 text-primary" : "text-text-muted hover:text-foreground"}`}
                                            >
                                                {mode === "text" ? tv("textGenerationMode") : tv("referenceGenerationMode")}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {(type !== "scene" || !usingSceneAi) && <div className="flex flex-wrap items-center gap-2">
                                    <select aria-label={type === "scene" ? "设计模型" : "提示词优化模型"} value={promptModel}
                                        onChange={event => setPromptModel(event.target.value)}
                                        className="h-9 min-w-0 flex-1 rounded border border-glass-border bg-surface px-2 text-xs text-foreground">
                                        {promptModels.length === 0 && <option value="">暂无可用模型</option>}
                                        {promptModels.map(model => <option key={model.api_model_id} value={model.api_model_id}>{model.display_name}</option>)}
                                    </select>
                                    <button type="button" onClick={() => void handleOptimizePrompt()}
                                        disabled={!promptModel || optimizingPrompt || sceneDesignSaving || !descriptionSaved || !description.trim() || (type === "scene" && sceneDesignNeedsApply)}
                                        className="inline-flex h-9 items-center gap-1.5 rounded border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg disabled:opacity-50">
                                        <Sparkles size={14} />{optimizingPrompt ? "优化中…" : type === "scene" ? "提交 AI 完善" : "优化提示词"}
                                    </button>
                                </div>}
                                {type === "scene" && usingSceneAi && <p className="text-xs text-text-muted">根据场景设计生成独立提示词，保留原设计供对比。修改场景设计后，可重新优化。</p>}
                                {usingSceneAi && sceneDesignNeedsApply && <p role="status" className="text-xs text-primary">
                                    基础面板有未应用的设置，请先检查。
                                    <button type="button" className="min-h-11 px-2 underline" onClick={() => { setScenePromptTab("design"); setShowSceneSettings(true); }}>检查场景设计</button>
                                </p>}
                                {promptError && <p role="alert" className="text-xs text-status-failed-fg">{promptError}</p>}
                                {pendingPromptReview && <VideoPolishReview messages={pendingPromptReview.messages}
                                    media={[]} formatNote={pendingPromptReview.formatNote} isContextIr={false}
                                    isSubmitting={optimizingPrompt} error={promptError} userLabel="资产描述与可见提示词"
                                    confirmLabel="确认输入并优化" onChange={messages => setPendingPromptReview(current => current && ({ ...current, messages }))}
                                    onCancel={() => setPendingPromptReview(null)} onConfirm={() => void confirmPromptRefine()} />}
                                {type !== "scene" && optimizedPrompt && <div className="space-y-2 border-l-2 border-primary pl-3">
                                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">{optimizedPrompt}</p>
                                    <div className="flex gap-3">
                                        <button type="button" onClick={() => { setImagePrompt(optimizedPrompt); setOptimizedPrompt(""); setSceneDesignNeedsApply(false); }} className="text-xs text-primary hover:underline">采用建议</button>
                                        <button type="button" onClick={() => setOptimizedPrompt("")} className="text-xs text-text-muted hover:underline">忽略</button>
                                    </div>
                                </div>}
                                <div className="relative rounded-lg border border-glass-border bg-input-bg p-3 focus-within:border-primary/50">
                                    <ReferencePromptEditor
                                        key={usingSceneAi ? "ai" : "design"}
                                        value={visibleImagePrompt}
                                        candidates={referenceCandidates}
                                        onChange={setVisibleImagePrompt}
                                        onReferencesChange={setVisibleReferences}
                                        restoreSelectedReferences={visibleReferences}
                                        onMentionChange={(suggestion) => { setMention(suggestion); setMentionIndex(0); }}
                                        onMentionKeyDown={handleMentionKeyDown}
                                        allowImplicitMentions={false}
                                        pruneUnlistedReferences
                                        editable={!isGenerating && !sceneDesignSaving && !(usingSceneAi && optimizingPrompt)}
                                        placeholder={tv("imagePromptPlaceholder")}
                                    />
                                    {mention && (
                                        <div role="listbox" aria-label="Reference index" className="absolute bottom-full left-0 z-50 mb-2 max-h-56 w-[min(100%,24rem)] overflow-y-auto rounded-xl border border-glass-border bg-elevated p-2 shadow-2xl">
                                            <div className="px-2 pb-1.5 pt-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">{tv("referenceIndex")} · {tv("referenceSearchHint")}</div>
                                            {matchingReferenceCandidates.length === 0 ? (
                                                <div className="px-2 py-2 text-xs text-text-muted">{referenceCandidates.length ? tv("noMatchingReference") : tv("noAvailableReference")}</div>
                                            ) : matchingReferenceCandidates.map((candidate, index) => (
                                                <button
                                                    key={`${candidate.reference?.asset_type}:${candidate.reference?.asset_id}:${candidate.reference?.variant_id}`}
                                                    type="button"
                                                    role="option"
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => { mention.choose(candidate); setMention(null); }}
                                                    aria-selected={index === mentionIndex}
                                                    className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover-bg ${index === mentionIndex ? "bg-hover-bg" : ""}`}
                                                >
                                                    {candidate.previewUrl ? <img src={candidate.previewUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <ImageIcon size={14} className="text-text-muted" />}
                                                    <span className="truncate text-xs text-foreground">{candidate.isActive ? "* " : ""}@{candidate.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {visibleReferences.length > 0 && (
                                    <p className="text-[0.6875rem] text-primary">{tv("explicitReferenceCount", { count: visibleReferences.length, suffix: visibleReferences.length === 1 ? "" : "s" })}</p>
                                )}
                                {type === "scene" && <>
                                    <p role="status" className="text-xs text-text-muted">{hasSavedSceneDesign
                                        ? `${sceneHasChanges ? "已保存的设计有修改" : "已保存 · 当前设计已生效"} · 保存的来源：${savedSceneSource === "ai" ? "AI 优化" : "场景设计"}`
                                        : "尚未保存"}</p>
                                    <div className="sticky bottom-0 flex gap-2 bg-surface py-2">
                                        <button type="button" disabled={sceneDesignSaving || optimizingPrompt || !visibleImagePrompt.trim() || !sceneDesign.visual_notes.trim()}
                                            onClick={() => void saveSceneDesign()} className="min-h-11 flex-1 rounded bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                            {sceneDesignSaving ? "保存中…" : usingSceneAi ? "保存并使用 AI 优化" : "保存并使用场景设计"}
                                        </button>
                                        <button type="button" disabled={sceneDesignSaving || optimizingPrompt || !hasSavedSceneDesign} onClick={restoreSavedSceneDesign}
                                            className="min-h-11 flex-1 rounded border border-glass-border px-3 text-sm text-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">编辑已保存设计</button>
                                    </div>
                                </>}
                            </div>
                        )}

                        {/* Video Prompt (Only visible in Video Tab) */}
                        {activeTab === "video" && (
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-text-secondary uppercase">Video Prompt</label>
                                <textarea
                                    value={videoPrompt}
                                    onChange={(e) => setVideoPrompt(e.target.value)}
                                    className="w-full h-24 bg-input-bg border border-glass-border rounded-lg p-3 text-sm text-text-secondary resize-none focus:border-primary focus:outline-none"
                                    placeholder="Describe the motion..."
                                />
                            </div>
                        )}

                        {/* Style Control (Only visible in Image Tab) */}
                        {activeTab === "image" && type !== "scene" && (
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-text-secondary uppercase">Style Settings</label>
                                <div className="bg-glass rounded-lg p-3 border border-border-subtle">
                                    <button type="button" onClick={() => {
                                        setImagePrompt((current: string) => includeVisibleStyle(current, stylePrompt));
                                        setNegativePrompt((current: string) => includeVisibleStyle(current, styleNegativePrompt));
                                    }} disabled={!stylePrompt && !styleNegativePrompt}
                                        className="mb-2 rounded border border-glass-border px-2 py-1 text-xs text-text-secondary disabled:opacity-40">
                                        {tv("copyStyleToPrompt")}
                                    </button>

                                    {stylePrompt && (
                                        <div className="text-xs text-text-muted font-mono bg-surface p-2 rounded border border-border-subtle">
                                            <span className="text-primary font-bold">Style:</span> {stylePrompt}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Advanced Settings (Negative Prompt) - Only visible in Image Tab */}
                        {activeTab === "image" && (
                            <div className="space-y-2">
                                <button
                                    onClick={() => setShowAdvanced(!showAdvanced)}
                                    className="flex items-center gap-2 text-xs font-bold text-text-muted hover:text-foreground transition-colors uppercase"
                                >
                                    <span>Advanced Settings (Negative Prompt)</span>
                                    <ChevronRight size={12} className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                                </button>

                                <AnimatePresence>
                                    {showAdvanced && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="overflow-hidden"
                                        >
                                            <textarea
                                                value={negativePrompt}
                                                onChange={(e) => setNegativePrompt(e.target.value)}
                                                className="w-full h-24 bg-input-bg border border-glass-border rounded-lg p-3 text-xs text-text-secondary resize-none focus:outline-none focus:border-primary/50 font-mono"
                                                placeholder="Enter negative prompt..."
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>

                </div>} preview={<div className="flex min-h-[360px] flex-1 flex-col p-4 lg:min-h-0">

                        {activeTab === "image" ? (
                            <VariantSelector
                                key={`${type}:${asset.id}`}
                                asset={asset.image_asset}
                                currentImageUrl={asset.image_url}
                                onSelect={handleSelectVariant}
                                onDelete={handleDeleteVariant}
                                onRename={handleRenameVariant}
                                onGenerate={handleGenerateClick}
                                isGenerating={isGenerating}
                                aspectRatio="16:9"
                                className="h-full"
                                previewLocator={currentProject ? {
                                    scope: asset.source === "series" && currentProject.series_id ? "series" : "project",
                                    containerId: asset.source === "series" && currentProject.series_id ? currentProject.series_id : currentProject.id,
                                    assetType: type,
                                    assetId: asset.id,
                                } : undefined}
                            />
                        ) : activeTab === "video" ? (
                            <VideoVariantSelector
                                videos={asset.video_assets || []}
                                onDelete={onDeleteVideo}
                                onGenerate={(duration) => onGenerateVideo(videoPrompt, duration)}
                                isGenerating={isGeneratingVideo}
                                aspectRatio="16:9"
                                className="h-full"
                            />
                        ) : null}
                </div>} />}
            </motion.div>
            {pendingImageReview && currentProject?.id && <AssetImageSubmissionReview
                projectId={currentProject.id}
                request={pendingImageReview}
                sourceLabel={pendingImageReview.scene_tool ? undefined : pendingPromptSource}
                referenceIndex={assetIndex}
                onBack={() => setPendingImageReview(null)}
                onConfirm={(review) => {
                    const request = pendingImageReview;
                    setPendingImageReview(null);
                    onGenerate(request.prompt, false, request.negative_prompt,
                        request.batch_size, request.references || [], request.image_generation_mode,
                        true, review.fingerprint, request.scene_tool);
                }}
            />}
        </div>
    );
}

function TabButton({ active, onClick, icon, label, count }: any) {
    return (
        <button
            onClick={onClick}
            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 border transition-colors ${active
                ? "bg-[rgba(100,108,255,0.12)] text-foreground border-primary"
                : "bg-glass text-text-secondary hover:text-foreground border-glass-border hover:border-glass-border-strong"
                }`}
        >
            <span className={active ? "text-primary" : ""}>{icon}</span>
            <span className="font-mono text-[0.65625rem] font-semibold uppercase tracking-[0.14em]">{label}</span>
            <span className={`font-mono text-[0.5625rem] px-1.5 py-0.5 rounded-full border ${
                active
                    ? "text-primary border-primary/40 bg-[rgba(100,108,255,0.08)]"
                    : "text-text-muted border-glass-border bg-black/30"
            }`}>{count}</span>
        </button>
    );
}

function ImageWithRetry({ src, alt, className }: { src: string, alt: string, className?: string }) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);

    // Reset state when src changes
    useEffect(() => {
        setIsLoading(true);
        setError(false);
    }, [src]);

    return (
        <div className={`relative ${className}`}>
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface z-10">
                    <RefreshCw className="animate-spin text-text-secondary" size={24} />
                </div>
            )}
            <img
                src={src}
                alt={alt}
                className={`${className} ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
                onLoad={() => setIsLoading(false)}
                onError={() => {
                    setError(true);
                    setIsLoading(false);
                }}
            />
            {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-500/10 backdrop-blur-sm z-20">
                    <span className="text-xs text-red-400 font-bold">Failed to load preview</span>
                </div>
            )}
        </div>
    );
}

function AssetCardCover({ asset, type, projectId, seriesId }: { asset: any; type: string; projectId: string; seriesId?: string }) {
    const variants = type === "character"
        ? [...(asset.reference_sheet?.image_variants || []), ...(asset.full_body_asset?.variants || []),
            ...(asset.three_view_asset?.variants || []), ...(asset.headshot_asset?.variants || [])]
        : asset.image_asset?.variants || [];
    const selectedId = type === "character"
        ? asset.reference_sheet?.selected_image_id || asset.full_body_asset?.selected_id
        : asset.image_asset?.selected_id;
    const variant = variants.find((item: any) => item.id === asset.cover_variant_id)
        || variants.find((item: any) => item.id === selectedId) || variants[0];
    const source = asset.source === "series" && seriesId ? "series" : "project";
    const containerId = source === "series" ? seriesId! : projectId;
    const [previewUrl, setPreviewUrl] = useState<string>();
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!variant?.id) return;
        const params = new URLSearchParams({ scope: source, container_id: containerId,
            asset_type: type, asset_id: asset.id, variant_id: variant.id });
        const controller = new AbortController();
        let objectUrl: string | undefined;
        setPreviewUrl(undefined);
        setFailed(false);
        authenticatedFetch(`${API_URL}/asset-index/preview?${params}`, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error("Preview unavailable");
                const blob = await response.blob();
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob);
                setPreviewUrl(objectUrl);
            })
            .catch(() => { if (!controller.signal.aborted) setFailed(true); });
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [asset.id, variant?.id, source, containerId, type]);

    const legacyUrl = type === "character" ? characterImageUrl(asset) : asset.image_url;
    const imageUrl = variant ? previewUrl : getAssetUrl(legacyUrl);
    if (imageUrl) return <ImageWithRetry src={imageUrl} alt={asset.name} className="w-full h-full object-contain" />;
    return <div className="w-full h-full flex items-center justify-center bg-glass">
        {variant && !failed ? <RefreshCw size={24} className="animate-spin text-text-secondary" /> : <ImageIcon className="text-text-muted" size={48} />}
    </div>;
}

function AssetCard({ asset, type, isGenerating, onGenerate, onToggleLock, onClick, onDelete, onUpload, onClearGenerationState, planCount = 0 }: any) {
    const tv = useTranslations("vault");
    const isLocked = asset.locked || false;
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentProject) return;

        try {
            // 1. Upload file
            const { url } = await api.uploadFile(file);

            // 2. Update asset image
            const updatedProject = await api.updateAssetImage(currentProject.id, asset.id, type, url);

            // 3. Update local state
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to upload asset image:", error);
            alert("Failed to upload image");
        }
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={onClick}
            className={`group relative aspect-[3/4] bg-surface rounded-2xl border overflow-hidden transition-colors cursor-pointer ${isLocked ? 'border-primary/60 border-dashed' : 'border-glass-border hover:border-primary/50'
                }`}
        >
            {/* Image Area */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60 z-10" />

            {currentProject && <AssetCardCover asset={asset} type={type} projectId={currentProject.id} seriesId={currentProject.series_id} />}

            {/* Loading Overlay */}
            {isGenerating && (
                <div className="absolute inset-0 z-20 bg-overlay backdrop-blur-sm flex items-center justify-center flex-col gap-2">
                    <RefreshCw className="animate-spin text-primary" size={32} />
                    <span className="text-xs font-mono text-primary">Generating...</span>
                </div>
            )}

            <AssetCoverBadges planCount={planCount} failed={asset.status === "failed" && !isGenerating} error={asset.generation_error} source={asset.source} />

            {/* Top Actions Overlay */}
            <div className="absolute top-2 right-2 z-30 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    className="p-2 rounded-full backdrop-blur-md bg-red-500/20 text-red-400 hover:bg-red-500/40 transition-colors"
                    title="Delete"
                >
                    <Trash2 size={14} />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleLock();
                    }}
                    className={`p-2 rounded-full backdrop-blur-md transition-colors ${isLocked
                        ? "bg-primary/20 text-primary hover:bg-primary/30"
                        : "bg-surface text-foreground hover:bg-hover-bg"
                        }`}
                >
                    {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
            </div>

            {/* Bottom Info */}
            <div className="absolute bottom-0 left-0 right-0 p-4 z-30">
                <h3 className="text-lg font-bold text-foreground mb-1 truncate">{asset.name}</h3>
                <p className="text-xs text-foreground/80 line-clamp-2 mb-3 h-8">
                    {asset.description || "No description"}
                </p>

                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0">
                    {asset.status === "failed" && !isGenerating && (
                        <WorkflowActionButton
                            onClick={(e) => {
                                e.stopPropagation();
                                onClearGenerationState?.();
                            }}
                            variant="secondary"
                            size="sm"
                            className="flex-1"
                        >
                            Clear
                        </WorkflowActionButton>
                    )}
                    <WorkflowActionButton
                        onClick={(e) => {
                            e.stopPropagation();
                            onGenerate();
                        }}
                        disabled={isLocked || isGenerating}
                        loading={isGenerating}
                        leftIcon={!isGenerating ? <RefreshCw /> : undefined}
                        variant="primary"
                        size="sm"
                        className="flex-1"
                    >
                        {isGenerating ? "Generating..." : "Generate"}
                    </WorkflowActionButton>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onUpload?.();
                        }}
                        className="px-2.5 rounded-full bg-glass hover:bg-hover-bg border border-glass-border text-foreground cursor-pointer transition-colors"
                        title={tv("uploadAsset")}
                    >
                        <Upload size={14} />
                    </button>
                </div>
            </div>
        </motion.div>
    );
}



function CreateAssetDialog({ type, onClose, onCreate }: { type: string; onClose: () => void; onCreate: (data: { name: string; description: string }) => void }) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!name.trim()) {
            alert("Name is required");
            return;
        }
        setIsSubmitting(true);
        try {
            await onCreate({ name: name.trim(), description: description.trim() });
        } finally {
            setIsSubmitting(false);
        }
    };

    const typeLabel = type === "character" ? "Character" : type === "scene" ? "Scene" : "Prop";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface border border-glass-border rounded-2xl w-full max-w-md overflow-hidden shadow-lg"
            >
                <div className="p-6 border-b border-glass-border flex justify-between items-center bg-surface">
                    <div className="flex items-center gap-3">
                        <Plus className="text-primary" size={20} />
                        <h2 className="text-lg font-bold text-foreground">Create New {typeLabel}</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-hover-bg rounded-lg transition-colors">
                        <X size={20} className="text-text-secondary" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">Name *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={`Enter ${type} name`}
                            className="w-full px-4 py-3 bg-input-bg border border-glass-border rounded-lg text-foreground placeholder-text-muted focus:border-primary/50 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={`Describe the ${type}...`}
                            rows={4}
                            className="w-full px-4 py-3 bg-input-bg border border-glass-border rounded-lg text-foreground placeholder-text-muted focus:border-primary/50 focus:outline-none resize-none"
                        />
                    </div>
                </div>

                <div className="p-6 border-t border-glass-border flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-glass hover:bg-hover-bg text-foreground rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !name.trim()}
                        className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSubmitting && <RefreshCw size={16} className="animate-spin" />}
                        Create {typeLabel}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
