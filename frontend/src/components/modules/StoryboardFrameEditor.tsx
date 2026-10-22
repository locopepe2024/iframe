"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Check, AlertTriangle, Image as ImageIcon, Lock, Unlock, ChevronRight, Maximize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { api, API_URL } from "@/lib/api";
import { resolveStoryboardStyleForRender } from "@/lib/storyboardStyle";
import { VariantSelector } from "../common/VariantSelector";
import { useProjectStore } from "@/store/projectStore";
import { resolveNegativePrompt, resolveStylePrompt } from "./storyboard-r2v/buildAssembledPrompt";
import RenderPromptPreviewDialog, { type FrameRenderPreview } from "./RenderPromptPreviewDialog";

interface StoryboardFrameEditorProps {
    frame: any;
    onClose: () => void;
}

function formatReferenceValue(value: unknown): string {
    if (Array.isArray(value)) return value.map(formatReferenceValue).filter(Boolean).join("、");
    if (value && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>)
            .map(([key, item]) => `${key}：${formatReferenceValue(item)}`)
            .filter(Boolean)
            .join("；");
    }
    return value == null ? "" : String(value).trim();
}

export default function StoryboardFrameEditor({ frame: initialFrame, onClose }: StoryboardFrameEditorProps) {
    const ts = useTranslations("storyboard");
    const currentProject = useProjectStore(state => state.currentProject);
    const currentSeries = useProjectStore(state => state.currentSeries);
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
    const [visualPresets, setVisualPresets] = useState<any[]>([]);
    const [selectedVisualPresetId, setSelectedVisualPresetId] = useState("");
    const [visualPresetApplyMode, setVisualPresetApplyMode] = useState<"image_only" | "image_and_context">("image_only");
    const [visualPresetProjection, setVisualPresetProjection] = useState<any | null>(null);
    const [selectedReferenceFields, setSelectedReferenceFields] = useState<string[]>([]);
    const [visualPresetProjectionLoading, setVisualPresetProjectionLoading] = useState(false);
    const [visualPresetFeedback, setVisualPresetFeedback] = useState("");
    const [visualPresetName, setVisualPresetName] = useState("");
    const [visualPresetBusy, setVisualPresetBusy] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [pendingRender, setPendingRender] = useState<FrameRenderPreview | null>(null);

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

    useEffect(() => {
        if (!currentProject?.id) return;
        api.listShotVisualPresets(currentProject.id)
            .then((presets: any[]) => setVisualPresets(Array.isArray(presets) ? presets : []))
            .catch(() => setVisualPresets([]));
    }, [currentProject?.id, frame.id]);

    useEffect(() => {
        let cancelled = false;
        setVisualPresetProjection(null);
        setSelectedReferenceFields([]);
        setVisualPresetFeedback("");
        if (!currentProject?.id || !frame.id || !selectedVisualPresetId) return () => { cancelled = true; };
        setVisualPresetProjectionLoading(true);
        api.previewShotVisualPreset(currentProject.id, frame.id, selectedVisualPresetId)
            .then((result) => { if (!cancelled) setVisualPresetProjection(result); })
            .catch(() => { if (!cancelled) { setVisualPresetProjection(null); setVisualPresetFeedback("无法读取所选参考，请重新选择素材。"); } })
            .finally(() => { if (!cancelled) setVisualPresetProjectionLoading(false); });
        return () => { cancelled = true; };
    }, [currentProject?.id, frame.id, selectedVisualPresetId]);

    const saveVisualPreset = async () => {
        if (!currentProject || !visualPresetName.trim()) return;
        setVisualPresetBusy(true);
        try {
            const preset = await api.saveShotVisualPreset(currentProject.id, frame.id, {
                name: visualPresetName.trim(),
                visual_design: frame.reference_visual_projection?.visual_design || {
                    lighting: lightingOverride ? { description: lightingOverride } : {},
                },
                compiled_prompt: "",
                source_variant_id: frame.rendered_image_asset?.selected_id || null,
            });
            setVisualPresets(current => [...current, preset]);
            setVisualPresetName("");
        } finally {
            setVisualPresetBusy(false);
        }
    };

    const applyVisualPreset = async () => {
        if (!currentProject || !selectedVisualPresetId) return;
        setVisualPresetFeedback("");
        setVisualPresetBusy(true);
        try {
            const updatedFrame = await api.applyShotVisualPreset(
                currentProject.id,
                frame.id,
                selectedVisualPresetId,
                visualPresetApplyMode,
                visualPresetApplyMode === "image_and_context" ? selectedReferenceFields : [],
            );
            updateProject(currentProject.id, {
                frames: (currentProject.frames ?? []).map((item: any) => item.id === frame.id ? updatedFrame : item),
            });
            setVisualPresetFeedback("参考已保存到本镜头，生成预览会显示实际提交内容。");
        } catch (error) {
            console.error("Failed to apply visual reference:", error);
            setVisualPresetFeedback("应用参考失败，请重试或重新选择素材。");
        } finally {
            setVisualPresetBusy(false);
        }
    };

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

            const { positivePrompt: globalStylePrompt, negativePrompt: globalNegativePrompt } =
                await resolveStoryboardStyleForRender(currentProject, currentSeries, async (seriesId) => {
                    const series = await api.getSeries(seriesId);
                    useProjectStore.getState().setCurrentSeries(series);
                    return series;
                });
            const effectivePrompt = frame.image_prompt_en?.trim() === prompt.trim()
                ? prompt
                : [resolveStylePrompt(globalStylePrompt, stylePromptOverride, lightingOverride), prompt].filter(Boolean).join(" . ");
            const preview = await api.previewFrameRender(currentProject.id, frame.id, effectivePrompt);
            setPendingRender({ ...preview, batchSize, referenceCount: null,
                negativePrompt: resolveNegativePrompt(globalNegativePrompt, "", negativePromptOverride) });
        } catch (error) {
            console.error("Failed to generate frame:", error);
            alert(ts("generateFailed"));
        } finally {
            setIsGenerating(false);
        }
    };

    const confirmGenerate = async () => {
        if (!currentProject || !pendingRender) return;
        const prepared = pendingRender;
        setPendingRender(null);
        setIsGenerating(true);
        try {
            const updatedProject = await api.renderFrame(
                currentProject.id, frame.id, null, prepared.prompt, prepared.batchSize,
                prepared.negativePrompt, true, prepared.contextToken,
            );
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to generate frame:", error);
            if ((error as any)?.response?.status === 409) {
                try {
                    const updatedProject = await api.getProject(currentProject.id);
                    updateProject(currentProject.id, updatedProject);
                } catch (refreshError) {
                    console.error("Could not refresh stale storyboard:", refreshError);
                }
                alert("镜头或资产已变化，请重新预览后生成。");
                return;
            }
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
            {pendingRender && <RenderPromptPreviewDialog preview={pendingRender}
                onClose={() => setPendingRender(null)} onConfirm={() => { void confirmGenerate(); }} />}
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
                                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-text-secondary">选择参考图</label>
                                        <p className="text-[0.6875rem] text-text-muted">默认只提交参考图。确认后可按类别带入来源素材的结构化视觉字段。</p>
                                    </div>
                                    <select aria-label="选择结构化视觉预设" value={selectedVisualPresetId} onChange={event => setSelectedVisualPresetId(event.target.value)} className="w-full rounded border border-glass-border bg-surface p-2 text-xs text-foreground">
                                        <option value="">选择参考素材或分镜</option>
                                        {visualPresets.map((preset: any) => <option key={preset.id} value={preset.id}>{preset.name} · 来源 {preset.source_asset_id ? `场景资产变体 ${preset.source_variant_id}` : `分镜 ${preset.source_frame_id}`}</option>)}
                                    </select>
                                    {visualPresetProjectionLoading && <p role="status" className="text-[0.6875rem] text-text-muted">正在读取来源字段…</p>}
                                    {visualPresetFeedback && <p role={visualPresetFeedback.includes("失败") || visualPresetFeedback.includes("无法") ? "alert" : "status"} className="text-[0.6875rem] text-text-secondary">{visualPresetFeedback}</p>}
                                    {visualPresetProjection && <div className="rounded border border-glass-border bg-surface/70 p-2 text-[0.6875rem] text-text-secondary">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>来源字段（需逐项确认）</span>
                                            <span className="text-text-muted">{visualPresetProjection.projection.scope === "same_time_world_light" ? "同时间·不同地点：仅世界光" : visualPresetProjection.projection.scope === "same_place_time" ? "同地点·同时间" : visualPresetProjection.projection.scope === "different_time" ? "不同时间：仅参考图" : "连续性 ID 未完整确认"}</span>
                                        </div>
                                        {!visualPresetProjection.projection.available_fields?.length && <p className="mt-2 text-text-muted">此来源没有可带入的结构化视觉字段，可仅使用参考图。</p>}
                                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                                            {(["lighting", "space", "camera", "continuity_state"] as const).map(field => {
                                                const value = visualPresetProjection.projection.visual_design?.[field];
                                                const available = visualPresetProjection.projection.eligible_fields?.includes(field);
                                                if (!value || !Object.keys(value).length) return null;
                                                const labels: Record<string, string> = { lighting: "光影", space: "空间", camera: "镜头", continuity_state: "连续性状态" };
                                                return <label key={field} className={`flex min-w-0 items-start gap-1.5 rounded border px-2 py-1.5 ${available ? "border-glass-border text-foreground" : "border-glass-border/50 text-text-muted"}`}>
                                                    <input type="checkbox" aria-label={`带入${labels[field]}`} className="mt-0.5 shrink-0" checked={selectedReferenceFields.includes(field)} disabled={!available || visualPresetApplyMode !== "image_and_context"} onChange={event => setSelectedReferenceFields(current => event.target.checked ? [...current, field] : current.filter(item => item !== field))} />
                                                    <span className="min-w-0"><span className="block font-medium">{labels[field]}</span><span className="mt-0.5 block break-words text-text-muted">{formatReferenceValue(value)}</span></span>
                                                </label>;
                                            })}
                                        </div>
                                    </div>}
                                    <div className="flex gap-2">
                                        <select aria-label="参考提交模式" value={visualPresetApplyMode} onChange={event => { const mode = event.target.value as "image_only" | "image_and_context"; setVisualPresetApplyMode(mode); if (mode === "image_only") setSelectedReferenceFields([]); }} className="min-w-0 flex-1 rounded border border-glass-border bg-surface p-2 text-xs text-foreground">
                                            <option value="image_only">仅参考图（默认）</option>
                                            <option value="image_and_context">参考图 + 已确认结构化字段</option>
                                        </select>
                                        <button type="button" onClick={() => void applyVisualPreset()} disabled={!selectedVisualPresetId || !visualPresetProjection?.reference_image_available || visualPresetProjectionLoading || visualPresetBusy || (visualPresetApplyMode === "image_and_context" && !selectedReferenceFields.length)} className="rounded bg-primary px-2 py-1 text-xs text-white disabled:opacity-40">确认应用</button>
                                    </div>
                                    {frame.reference_visual_projection?.source_preset_id && <p className="text-[0.6875rem] text-text-muted">当前参考：{frame.reference_visual_projection.source_preset_id} · {frame.reference_visual_projection.selected_fields?.length ? `已确认 ${frame.reference_visual_projection.selected_fields.join("、")}` : "仅参考图"}</p>}
                                    <div className="flex gap-2">
                                        <input aria-label="视觉预设名称" value={visualPresetName} onChange={event => setVisualPresetName(event.target.value)} placeholder="保存当前参数为预设" className="min-w-0 flex-1 rounded border border-glass-border bg-surface p-2 text-xs text-foreground" />
                                        <button type="button" onClick={() => void saveVisualPreset()} disabled={!visualPresetName.trim() || visualPresetBusy} className="rounded border border-glass-border px-2 py-1 text-xs text-foreground disabled:opacity-40">保存预设</button>
                                    </div>
                                </div>
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
