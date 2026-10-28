"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type AssetImageReviewProjection, type AssetImageReviewRequest, type AssetReferenceIndexEntry } from "@/lib/api";
import { extractErrorDetail } from "@/lib/utils";
import { AssetIndexPreview } from "@/components/shared/AssetIndexPreview";
import { describeSceneDirection } from "@/lib/sceneDirection";

type Props = {
    projectId: string;
    scope?: "project" | "series";
    request: AssetImageReviewRequest;
    referenceIndex?: AssetReferenceIndexEntry[];
    editor?: ReactNode;
    validationError?: string;
    sourceLabel?: string;
    onBack: () => void;
    onConfirm: (review: AssetImageReviewProjection) => void;
};

export default function AssetImageSubmissionReview({ projectId, scope = "project", request, referenceIndex, editor, validationError = "", sourceLabel, onBack, onConfirm }: Props) {
    const [review, setReview] = useState<AssetImageReviewProjection | null>(null);
    const [reviewedProject, setReviewedProject] = useState("");
    const [reviewedRequest, setReviewedRequest] = useState<AssetImageReviewRequest | null>(null);
    const [error, setError] = useState("");
    const confirmRef = useRef<HTMLButtonElement>(null);
    const backRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        backRef.current?.focus();
        return () => previousFocus?.focus();
    }, []);

    useEffect(() => {
        let active = true;
        setReview(null);
        setError("");
        if (validationError) return;
        if (!request.prompt.trim()) { setError("请填写出图提示词。"); return; }
        (scope === "series" ? api.previewSeriesAssetImageSubmission(projectId, request) : api.previewAssetImageSubmission(projectId, request)).then((result) => {
            if (!active) return;
            if (result.positive_prompt !== request.prompt || result.negative_prompt !== request.negative_prompt) {
                setError("预览文本与待提交文本不一致，请返回检查。 ");
                return;
            }
            setReview(result);
            setReviewedRequest(request);
            setReviewedProject(projectId);
        }).catch((cause) => {
            if (active) setError(extractErrorDetail(cause, "无法获取提交预览"));
        });
        return () => { active = false; };
    }, [projectId, scope, request, validationError]);

    const currentReview = reviewedRequest === request && reviewedProject === projectId && !validationError ? review : null;

    useEffect(() => { if (review && !editor) confirmRef.current?.focus(); }, [review, editor]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3" onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) onBack();
        }}>
            <section role="dialog" aria-modal="true" aria-label="核对图片生成请求"
                className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-xl border border-glass-border bg-surface p-5 shadow-2xl">
                <h2 className="text-base font-semibold text-foreground">生成前核对</h2>
                {sourceLabel && <p className="mt-2 text-sm text-primary">提示词来源：{sourceLabel}</p>}
                <p className="mt-1 text-xs text-text-secondary">请核对实际提交内容；修改后会重新获取预览。</p>
                {editor}
                {validationError || error ? <p role="alert" className="mt-4 text-sm text-red-400">{validationError || error}</p> : !currentReview ?
                    <p role="status" className="mt-4 text-sm text-text-secondary">正在读取实际模型与画幅…</p> : <>
                    <div className="mt-4 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                        <p>模型：<span className="text-foreground">{currentReview.selected_model_id}</span></p>
                        <p>画幅：<span className="text-foreground">{currentReview.aspect_ratio}</span></p>
                        <p>模式：<span className="text-foreground">{currentReview.image_generation_mode === "reference" ? "参考生图" : "文生图"}</span></p>
                        <p>图片类型：<span className="text-foreground">{currentReview.generation_type}</span></p>
                        <p>数量：<span className="text-foreground">{currentReview.batch_size}</span></p>
                        <p>确认设计版本：<span className="text-foreground">{currentReview.design_revision_at_submission ?? "未确认"}</span></p>
                    </div>
                    {currentReview.scene_tool && <div className="mt-4 rounded border border-glass-border bg-surface-inset p-3 text-xs text-foreground">
                        <h3 className="font-medium">场景图片编辑参数</h3>
                        {currentReview.scene_tool.kind === "camera" ? <p className="mt-1">
                            镜头 · {currentReview.scene_tool.preset} · 水平 {currentReview.scene_tool.yaw}° · 俯仰 {currentReview.scene_tool.pitch}° · 景别档位 {currentReview.scene_tool.zoom}
                            {currentReview.scene_tool.focus ? ` · 对焦 x=${currentReview.scene_tool.focus_x}%, y=${currentReview.scene_tool.focus_y}%, 范围 ${currentReview.scene_tool.focus_radius}%` : ""}
                        </p> : <p className="mt-1">
                            光影 · {currentReview.scene_tool.azimuth != null && currentReview.scene_tool.elevation != null
                                ? `${describeSceneDirection(currentReview.scene_tool.azimuth, currentReview.scene_tool.elevation)} · 方位 ${currentReview.scene_tool.azimuth}° / 仰角 ${currentReview.scene_tool.elevation}°`
                                : currentReview.scene_tool.light_side} 主光 · 亮度 {currentReview.scene_tool.brightness}% · 颜色 {currentReview.scene_tool.color}
                        </p>}
                        <p className="mt-1 text-text-muted">来源图为下方第一张参考图；光影参考图如有则为第二张。</p>
                    </div>}
                    <div className="mt-4 space-y-3">
                        {!editor && <><div><h3 className="text-xs font-medium text-text-secondary">正向提示词</h3>
                            <p className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded border border-glass-border bg-surface-inset p-3 text-sm text-foreground">{currentReview.positive_prompt}</p></div>
                        <div><h3 className="text-xs font-medium text-text-secondary">负面提示词</h3>
                            <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded border border-glass-border bg-surface-inset p-3 text-sm text-foreground">{currentReview.negative_prompt || "无"}</p></div></>}
                        <div><h3 className="text-xs font-medium text-text-secondary">参考图（稳定资产与变体 ID）</h3>
                            {currentReview.reference_inputs.length ? <ul className="mt-1 space-y-1 rounded border border-glass-border bg-surface-inset p-3 text-xs text-foreground">
                                {currentReview.reference_inputs.map((item) => {
                                    const indexed = referenceIndex?.find((entry) => entry.asset_type === item.asset_type && entry.asset_id === item.asset_id
                                        && entry.variants.some((variant) => variant.id === item.variant_id));
                                    return <li key={`${item.asset_type}:${item.asset_id}:${item.variant_id}`} className="flex items-center gap-2 break-all">
                                        {indexed && <span className="h-12 w-12 shrink-0 overflow-hidden rounded bg-black/20">
                                            <AssetIndexPreview asset={{ ...indexed, variant_id: item.variant_id }} alt={`${indexed.name} 参考图`} />
                                        </span>}
                                        <span>{indexed ? `${indexed.name} · ${indexed.source_scope} · ` : ""}{item.asset_type} · {item.asset_id} · {item.variant_id}</span>
                                    </li>;
                                })}
                            </ul> : <p className="mt-1 text-xs text-text-muted">无参考图</p>}</div>
                    </div>
                </>}
                <div className="mt-5 flex justify-end gap-2">
                    <button ref={backRef} type="button" onClick={onBack} className="rounded border border-glass-border px-4 py-2 text-sm text-text-secondary hover:text-foreground">返回修改</button>
                    <button ref={confirmRef} type="button" disabled={!currentReview || Boolean(error)} onClick={() => currentReview && onConfirm(currentReview)}
                        className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">确认并生成</button>
                </div>
            </section>
        </div>
    );
}
