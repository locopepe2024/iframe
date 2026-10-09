"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Paintbrush, User, Users, MapPin, Box, Lock, Unlock, RefreshCw, Upload, Image as ImageIcon, X, Check, Settings, ChevronRight, Trash2, Plus, Link as LinkIcon } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { api, API_URL, authenticatedFetch, crudApi, type AssetLibraryReference } from "@/lib/api";
import { extractErrorDetail, getAssetUrl } from "@/lib/utils";
import CharacterWorkbench from "./CharacterWorkbench";
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
    normalizeTaskFailureDetail,
} from "@/lib/assetTaskPolling";
import ReferencePromptEditor, { type ReferenceCandidate, type ReferenceSuggestion } from "./playground/ReferencePromptEditor";
import { toast } from "@/store/toastStore";
import type { EpisodeAssetSyncDiff, EpisodeVisualContext, EpisodeVisualContextState } from "@/lib/directorShootingPlan";
import { getAssetPlanEntries, getUnboundCharacterRequirements, type AssetPlanEntry } from "@/lib/episodeAssetPlan";
import EpisodeAssetPlanPanel from "./EpisodeAssetPlanPanel";
import AssetCoverBadges from "./AssetCoverBadges";
import { characterImageUrl } from "@/lib/characterImage";

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
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to update description:", error);
        }
    };

    const handleUpdateAttributes = async (assetId: string, type: string, attributes: Record<string, unknown>) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.updateAssetAttributes(currentProject.id, assetId, type, attributes);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to update asset attributes:", error);
        }
    };

    const handleRenameAsset = async (assetId: string, type: string, name: string) => {
        if (!currentProject) return;
        const updatedProject = await api.updateAssetAttributes(currentProject.id, assetId, type, { name });
        updateProject(currentProject.id, updatedProject);
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

    const handleGenerate = async (assetId: string, type: string, generationType: string = "all", prompt: string = "", applyStyle: boolean = true, negativePrompt: string = "", batchSize: number = 1, references: AssetLibraryReference[] = [], imageGenerationMode: "text" | "reference" = "text") => {
        if (!currentProject) return;

        // Add task with specific generation type and batch size
        if (addGeneratingTask) {
            addGeneratingTask(assetId, generationType, batchSize);
        }

        try {
            const stylePrompt = currentProject?.art_direction?.style_config?.positive_prompt || "";

            console.log("[handleGenerate] Starting asset generation...");

            // Call API - now returns immediately with task_id
            const response = await api.generateAsset(
                currentProject.id,
                assetId,
                type,
                "ArtDirection",
                stylePrompt,
                generationType,
                prompt,
                applyStyle,
                negativePrompt,
                batchSize,
                currentProject.series_id ? undefined : resolveAssetGenerationModel(currentProject.model_settings?.t2i_model),
                undefined,
                undefined,
                references,
                imageGenerationMode,
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
            // Refresh project data
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete asset:", error);
            const detail = (error as any)?.response?.data?.detail;
            alert(detail?.error === "series_asset_in_use"
                ? "资产仍被分集引用，删除未完成。请刷新后重试或检查引用。"
                : extractErrorDetail(error, "Failed to delete asset"));
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
                    新增 {episodeAssetSync.new_bindings?.length || 0} · 可复用 {episodeAssetSync.reusable_bindings?.length || 0} ·
                    变更 {episodeAssetSync.changed_bindings?.length || 0} · 过期 {episodeAssetSync.stale_bindings?.length || 0}。
                    资产不会被自动生成或覆盖。
                    {!!episodeAssetSync.unresolved_bindings.length && <span> 待绑定 {episodeAssetSync.unresolved_bindings.length}，请在拍摄计划中检查资产引用。</span>}
                </div>
            )}

            {((episodeAssetSync?.bindings.length || episodeAssetState.bindings.length) > 0 ||
                getUnboundCharacterRequirements(episodeAssetState.context).length > 0) && currentProject && (
                <ShootingPlanAssetRequirements
                    bindings={episodeAssetSync?.bindings || episodeAssetState.bindings}
                    context={episodeAssetState.context}
                    project={currentProject}
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
                                onGenerate={() => handleGenerate(asset.id, activeTab)}
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
                            onGenerate={(type: string, prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number, references?: AssetLibraryReference[], imageGenerationMode?: "text" | "reference") => handleGenerate(selectedAssetId, selectedAssetType, type, prompt, applyStyle, negativePrompt, batchSize, references, imageGenerationMode)}
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
                            onGenerate={(prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number, references?: AssetLibraryReference[], imageGenerationMode?: "text" | "reference") => handleGenerate(selectedAssetId, selectedAssetType, "all", prompt, applyStyle, negativePrompt, batchSize, references, imageGenerationMode)}
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
    onOpenAsset,
}: {
    bindings: EpisodeVisualContextState["bindings"];
    context: EpisodeVisualContext | null;
    project: any;
    onOpenAsset: (assetType: "character" | "scene" | "prop", assetId: string) => void;
}) {
    const unboundCharacters = getUnboundCharacterRequirements(context);
    const groups: Array<{ type: "character" | "scene" | "prop"; label: string; items: typeof bindings }> = [
        { type: "character", label: "角色", items: bindings.filter(item => item.asset_type === "character") },
        { type: "scene", label: "场景", items: bindings.filter(item => item.asset_type === "scene") },
        { type: "prop", label: "道具", items: bindings.filter(item => item.asset_type === "prop") },
    ];
    const getAsset = (type: "character" | "scene" | "prop", id: string) => {
        const list = type === "character" ? project.characters : type === "scene" ? project.scenes : project.props;
        return list?.find((asset: any) => asset.id === id);
    };
    const statusLabel = (status: string) => status === "accepted" ? "已采纳" : status === "stale" ? "需复核" : "待生成";

    return (
        <section className="mx-6 mt-3 rounded-lg border border-glass-border bg-surface px-4 py-3" aria-label="拍摄计划资产需求">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <h3 className="text-sm font-medium text-foreground">拍摄计划资产需求</h3>
                    <p className="mt-1 text-xs text-text-secondary">这里展示分镜前置需求。打开已有基础资产后再生成场景变体，系统不会自动生成图片。</p>
                </div>
                <span className="text-xs text-text-muted">{bindings.length} 条绑定{unboundCharacters.length > 0 && ` · ${unboundCharacters.length} 个人物待绑定`}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
                {groups.map(group => (
                    <div key={group.type} className="min-w-0 rounded-md border border-glass-border bg-glass/40 p-3">
                        <div className="flex items-center justify-between text-xs font-medium text-text-secondary">
                            <span>{group.label}</span><span>{group.items.length + (group.type === "character" ? unboundCharacters.length : 0)}</span>
                        </div>
                        {group.items.length === 0 && (group.type !== "character" || unboundCharacters.length === 0) ? (
                            <p className="mt-2 text-xs text-text-muted">暂无拍摄计划需求</p>
                        ) : (
                            <div className="mt-2 max-h-32 space-y-2 overflow-y-auto">
                                {group.items.map(binding => {
                                    const asset = getAsset(group.type, binding.asset_id);
                                    return (
                                        <div key={`${binding.asset_type}:${binding.asset_id}`} className="flex items-start justify-between gap-2 rounded border border-glass-border/70 px-2 py-1.5">
                                            <div className="min-w-0">
                                                <p className="truncate text-xs text-foreground">{asset?.name || "计划需求（尚无基础资产）"}</p>
                                                <p className="text-[0.6875rem] text-text-muted">{binding.scene_ids.length} 个场景 · {binding.shot_ids.length} 个镜头 · {statusLabel(binding.status)}</p>
                                            </div>
                                            {asset && <button type="button" className="shrink-0 text-[0.6875rem] text-primary hover:underline" onClick={() => onOpenAsset(group.type, asset.id)}>打开资产</button>}
                                        </div>
                                    );
                                })}
                                {group.type === "character" && unboundCharacters.map((requirement, index) => (
                                    <div key={`unbound:${requirement.personId}`} className="rounded border border-glass-border/70 px-2 py-1.5" title={requirement.personId}>
                                        <p className="truncate text-xs text-foreground">人物 {index + 1} · {requirement.personId.slice(0, 8)}</p>
                                        <p className="text-[0.6875rem] text-text-muted">{requirement.sceneIds.length} 个场景 · {requirement.shotIds.length} 个镜头 · {requirement.lookCount} 条造型需求 · 待关联角色资产</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}

function CharacterDetailModal({ asset, type, onClose, onUpdateDescription, onGenerate, isGenerating, stylePrompt = "", styleNegativePrompt = "", onGenerateVideo, onDeleteVideo, isGeneratingVideo, planEntries = [] }: any) {
    const tv = useTranslations("vault");
    const [description, setDescription] = useState(asset.description);
    const [isEditing, setIsEditing] = useState(false);
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const selectionQueue = useRef<Promise<void>>(Promise.resolve());
    const selectionVersion = useRef(0);
    const [imagePrompt, setImagePrompt] = useState(asset.image_prompt || asset.description || "");
    const [imageGenerationMode, setImageGenerationMode] = useState<"text" | "reference">("text");
    const [promptReferences, setPromptReferences] = useState<AssetLibraryReference[]>([]);
    const [assetIndex, setAssetIndex] = useState<any[]>([]);
    const assetIndexRevision = JSON.stringify(
        [currentProject?.characters, currentProject?.scenes, currentProject?.props].map((items) =>
            Array.isArray(items) ? items.map((item: any) => [
                item?.id,
                item?.updated_at,
                item?.image_asset?.variants?.map((variant: any) => variant.id),
                item?.reference_sheet?.image_variants?.map((variant: any) => variant.id),
                item?.full_body_asset?.variants?.map((variant: any) => variant.id),
                item?.three_view_asset?.variants?.map((variant: any) => variant.id),
                item?.headshot_asset?.variants?.map((variant: any) => variant.id),
            ]) : [],
        ),
    );
    const [mention, setMention] = useState<ReferenceSuggestion | null>(null);

    // Style Controls
    const [applyStyle, setApplyStyle] = useState(true);
    const [negativePrompt, setNegativePrompt] = useState(styleNegativePrompt || DEFAULT_CHARACTER_NEGATIVE_PROMPT);
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Video Controls
    const [activeTab, setActiveTab] = useState<"image" | "video">("image");
    const [videoPrompt, setVideoPrompt] = useState(asset.video_prompt || "");

    // Sync local state if asset changes
    useEffect(() => {
        setDescription(asset.description);
        setImagePrompt(asset.image_prompt || asset.description || "");
        setPromptReferences([]);
        setMention(null);
        if (asset.video_prompt) setVideoPrompt(asset.video_prompt);
        else if (!videoPrompt) {
            setVideoPrompt(buildCharacterVideoPrompt(asset.name, asset.description));
        }
    }, [asset]);

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
            const variantLabel = variant.reference_view_role || variant.reference_distance || `View ${index + 1}`;
            const baseLabel = entry.variants.length > 1 ? `${entry.name} · ${variantLabel}` : entry.name;
            let label = baseLabel;
            let suffix = 2;
            while (labels.has(label)) label = `${baseLabel} ${suffix++}`;
            labels.add(label);
            return {
                label,
                previewUrl: getAssetUrl(variant.url),
                sourceLabel: entry.source_scope,
                variantLabel,
                reference: { asset_type: entry.asset_type, asset_id: entry.asset_id, variant_id: variant.id },
            };
        }).filter(Boolean) as ReferenceCandidate[]);
    }, [assetIndex]);

    const matchingReferenceCandidates = referenceCandidates.filter((candidate) =>
        candidate.label.toLocaleLowerCase().includes(mention?.query.toLocaleLowerCase() ?? ""),
    );

    // Sync negative prompt if style changes
    useEffect(() => {
        if (styleNegativePrompt && (!negativePrompt || negativePrompt.includes("low quality"))) {
            setNegativePrompt(styleNegativePrompt);
        }
    }, [styleNegativePrompt]);

    const handleSave = () => {
        onUpdateDescription(description);
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

    const handleGenerateClick = (batchSize: number) => {
        if (imageGenerationMode === "reference" && promptReferences.length === 0) {
            toast.warning(tv("referenceModeRequiresExplicit"));
            return;
        }
        if (imageGenerationMode === "text" && promptReferences.length > 0) {
            toast.warning(tv("referenceModeSelectExplicitly"));
            return;
        }
        onGenerate(imagePrompt, applyStyle, negativePrompt, batchSize, promptReferences, imageGenerationMode);
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface border border-glass-border rounded-2xl w-full max-w-5xl h-[85vh] flex overflow-hidden shadow-lg"
            >
                {/* Left: Variant Selector */}
                <div className="w-1/2 bg-surface relative border-r border-glass-border flex flex-col overflow-hidden">
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
                    </div>

                    <div className="flex-1 p-4 overflow-hidden">
                        {activeTab === "image" ? (
                            <VariantSelector
                                key={`${type}:${asset.id}`}
                                asset={asset.image_asset}
                                currentImageUrl={asset.image_url}
                                onSelect={handleSelectVariant}
                                onDelete={handleDeleteVariant}
                                onGenerate={handleGenerateClick}
                                isGenerating={isGenerating}
                                aspectRatio="16:9"
                                className="h-full"
                            />
                        ) : (
                            <VideoVariantSelector
                                videos={asset.video_assets || []}
                                onDelete={onDeleteVideo}
                                onGenerate={(duration) => onGenerateVideo(videoPrompt, duration)}
                                isGenerating={isGeneratingVideo}
                                aspectRatio="16:9"
                                className="h-full"
                            />
                        )}
                    </div>
                </div>

                {/* Right: Details */}
                <div className="w-1/2 flex flex-col">
                    {/* Header */}
                    <div className="p-6 border-b border-glass-border flex justify-between items-center bg-surface">
                        <h2 className="text-2xl font-bold text-foreground">{asset.name}</h2>
                        <button onClick={onClose} className="p-2 hover:bg-hover-bg rounded-full text-text-secondary hover:text-foreground">
                            <X size={24} />
                        </button>
                    </div>

                    <EpisodeAssetPlanPanel entries={planEntries} onUse={(text) => setImagePrompt((previous: string) => `${previous.trim()}\n${text}`.trim())} />

                    {/* Content */}
                    <div className="flex-1 p-6 overflow-y-auto space-y-6">
                        {/* Description */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-sm font-bold text-text-secondary uppercase">Description</label>
                                {!isEditing && (
                                    <button onClick={() => setIsEditing(true)} className="text-xs text-primary hover:underline">
                                        Edit
                                    </button>
                                )}
                            </div>
                            {isEditing ? (
                                <div className="space-y-2">
                                    <textarea
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        className="w-full h-32 bg-input-bg border border-glass-border rounded-lg p-3 text-sm text-text-secondary resize-none focus:border-primary focus:outline-none"
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button onClick={() => { setIsEditing(false); setDescription(asset.description); }} className="px-3 py-1.5 text-xs text-text-secondary hover:text-foreground">Cancel</button>
                                        <button onClick={handleSave} className="px-3 py-1.5 bg-primary text-white text-xs rounded hover:bg-primary/90">Save Description</button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-text-secondary leading-relaxed bg-glass p-3 rounded-lg border border-transparent hover:border-glass-border transition-colors">
                                    {asset.description}
                                </p>
                            )}
                        </div>

                        {/* Image generation description. Selecting/uploading a
                            variant only makes it available; @ in this editor
                            is the explicit binding sent to the provider. */}
                        {activeTab === "image" && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-bold text-text-secondary uppercase">{tv("imagePromptLabel")}</label>
                                    <div className="flex items-center gap-1 rounded-md border border-glass-border bg-black/20 p-1" role="group" aria-label="Image generation mode">
                                        {(["text", "reference"] as const).map((mode) => (
                                            <button
                                                key={mode}
                                                type="button"
                                                aria-pressed={imageGenerationMode === mode}
                                                onClick={() => setImageGenerationMode(mode)}
                                                className={`rounded px-2 py-1 text-[0.6875rem] ${imageGenerationMode === mode ? "bg-primary/15 text-primary" : "text-text-muted hover:text-foreground"}`}
                                            >
                                                {mode === "text" ? tv("textGenerationMode") : tv("referenceGenerationMode")}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="relative rounded-lg border border-glass-border bg-input-bg p-3 focus-within:border-primary/50">
                                    <ReferencePromptEditor
                                        value={imagePrompt}
                                        candidates={referenceCandidates}
                                        onChange={setImagePrompt}
                                        onReferencesChange={setPromptReferences}
                                        onMentionChange={setMention}
                                        allowImplicitMentions={false}
                                        pruneUnlistedReferences
                                        editable={!isGenerating}
                                        placeholder={tv("imagePromptPlaceholder")}
                                    />
                                    {mention && (
                                        <div role="listbox" aria-label="Reference index" className="absolute bottom-full left-0 z-50 mb-2 max-h-56 w-[min(100%,24rem)] overflow-y-auto rounded-xl border border-glass-border bg-elevated p-2 shadow-2xl">
                                            <div className="px-2 pb-1.5 pt-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-text-muted">{tv("referenceIndex")}</div>
                                            {matchingReferenceCandidates.length === 0 ? (
                                                <div className="px-2 py-2 text-xs text-text-muted">{referenceCandidates.length ? tv("noMatchingReference") : tv("noAvailableReference")}</div>
                                            ) : matchingReferenceCandidates.map((candidate) => (
                                                <button
                                                    key={`${candidate.reference?.asset_type}:${candidate.reference?.asset_id}:${candidate.reference?.variant_id}`}
                                                    type="button"
                                                    role="option"
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => { mention.choose(candidate); setMention(null); }}
                                                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover-bg"
                                                >
                                                    {candidate.previewUrl ? <img src={candidate.previewUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <ImageIcon size={14} className="text-text-muted" />}
                                                    <span className="truncate text-xs text-foreground">@{candidate.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {promptReferences.length > 0 && (
                                    <p className="text-[0.6875rem] text-primary">{tv("explicitReferenceCount", { count: promptReferences.length, suffix: promptReferences.length === 1 ? "" : "s" })}</p>
                                )}
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
                        {activeTab === "image" && (
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-text-secondary uppercase">Style Settings</label>
                                <div className="bg-glass rounded-lg p-3 border border-border-subtle">
                                    <div className="flex items-center gap-2 mb-2">
                                        <input
                                            type="checkbox"
                                            id="applyStyleModal"
                                            checked={applyStyle}
                                            onChange={(e) => setApplyStyle(e.target.checked)}
                                            className="rounded border-gray-600 bg-gray-700 text-primary focus:ring-primary"
                                        />
                                        <label htmlFor="applyStyleModal" className="text-sm font-bold text-text-secondary cursor-pointer select-none">
                                            Apply Art Direction Style
                                        </label>
                                    </div>

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

                    {/* Footer Actions */}
                    <div className="p-6 border-t border-glass-border bg-surface flex gap-4">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-foreground rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-500/20"
                        >
                            <Check size={18} />
                            Done
                        </button>
                    </div>
                </div>
            </motion.div>
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

            <AssetCoverBadges planCount={planCount} failed={asset.status === "failed" && !isGenerating} error={asset.generation_error} />

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
