"use client";

import { X } from "lucide-react";

export type FrameRenderPreview = {
    prompt: string;
    negativePrompt: string;
    referenceCount: number | null;
    batchSize: number;
    contextToken: string;
    model?: string;
    aspectRatio?: string;
    sourceLabel?: string;
    referenceLabels?: string[];
    omittedPlanLighting?: string;
    polishReview?: string;
};

export default function RenderPromptPreviewDialog({
    preview, onConfirm, onClose,
}: {
    preview: FrameRenderPreview;
    onConfirm: () => void;
    onClose: () => void;
}) {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay p-4" role="dialog" aria-modal="true" aria-label="生成输入预览">
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-glass-border bg-elevated shadow-lg">
                <div className="flex items-center justify-between border-b border-glass-border px-5 py-4">
                    <h2 className="text-base font-semibold text-foreground">生成输入预览</h2>
                    <button type="button" onClick={onClose} title="关闭" aria-label="关闭" className="rounded p-1 text-text-secondary hover:bg-hover-bg"><X size={18} /></button>
                </div>
                <div className="space-y-4 overflow-y-auto p-5 text-sm">
                    <div className="flex gap-4 text-text-secondary">
                        <span>{preview.referenceCount === null ? "参考图按镜头资产选择" : `参考图 ${preview.referenceCount}`}</span>
                        <span>生成 {preview.batchSize} 张</span>
                    </div>
                    {(preview.model || preview.aspectRatio || preview.sourceLabel) && <p className="text-text-secondary">
                        {[preview.sourceLabel, preview.model, preview.aspectRatio].filter(Boolean).join(" · ")}
                    </p>}
                    {preview.omittedPlanLighting && <p role="note" className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-text-secondary">
                        拍摄计划原光影：{preview.omittedPlanLighting}。系统不会在当前正文后额外追加这条；请核对正向提示词是否仍保留该描述。
                    </p>}
                    {preview.polishReview && <p role="alert" className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-text-secondary">
                        {preview.polishReview} 系统不会自动改写正文；重新润色可更新设计来源。
                    </p>}
                    {preview.referenceLabels && <p className="text-text-secondary">镜头关联素材：{preview.referenceLabels.length ? preview.referenceLabels.join("、") : "无"}。生成器会尝试使用这些素材当前选中的参考图。</p>}
                    <div>
                        <h3 className="mb-2 font-medium text-foreground">正向提示词</h3>
                        <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded border border-glass-border bg-surface p-3 font-sans leading-relaxed text-text-secondary">{preview.prompt}</pre>
                    </div>
                    {preview.negativePrompt && <div>
                        <h3 className="mb-2 font-medium text-foreground">负向提示词</h3>
                        <p className="whitespace-pre-wrap break-words text-text-secondary">{preview.negativePrompt}</p>
                    </div>}
                </div>
                <div className="flex justify-end gap-2 border-t border-glass-border px-5 py-4">
                    <button type="button" onClick={onClose} className="rounded border border-glass-border px-4 py-2 text-sm text-foreground">返回</button>
                    <button type="button" onClick={onConfirm} className="rounded bg-primary px-4 py-2 text-sm font-medium text-foreground">确认生成</button>
                </div>
            </div>
        </div>
    );
}
