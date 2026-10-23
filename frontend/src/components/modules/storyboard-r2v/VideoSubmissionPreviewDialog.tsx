"use client";

import { X } from "lucide-react";
import { getAssetUrl } from "@/lib/utils";

export type VideoSubmissionPreview = {
    prompt: string;
    negativePrompt: string;
    model: string;
    mode: string;
    duration: number;
    resolution: string;
    count: number;
    generateAudio: boolean;
    references: string[];
    settings: Array<{ label: string; value: string }>;
    firstFrame?: string;
    lastFrame?: string;
};

export default function VideoSubmissionPreviewDialog({ preview, onConfirm, onClose }: {
    preview: VideoSubmissionPreview;
    onConfirm: () => void;
    onClose: () => void;
}) {
    const media = [
        ...preview.references.map((url, index) => ({ url, label: `参考素材 ${index + 1}` })),
        ...(preview.firstFrame ? [{ url: preview.firstFrame, label: "首帧" }] : []),
        ...(preview.lastFrame ? [{ url: preview.lastFrame, label: "尾帧" }] : []),
    ];
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay p-4" role="dialog" aria-modal="true" aria-label="视频提交输入预览">
        <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-glass-border bg-elevated shadow-lg">
            <div className="flex items-center justify-between border-b border-glass-border px-5 py-4">
                <h2 className="text-base font-semibold text-foreground">视频提交输入预览</h2>
                <button type="button" onClick={onClose} title="关闭" aria-label="关闭" className="rounded p-1 text-text-secondary hover:bg-hover-bg"><X size={18} /></button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5 text-sm">
                <p className="text-text-secondary">{preview.model} · {preview.mode} · {preview.duration}s · {preview.resolution} · {preview.count} 条 · 生成声音：{preview.generateAudio ? "是" : "否"}</p>
                {preview.settings.length > 0 && <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-secondary sm:grid-cols-3">
                    {preview.settings.map(item => <div key={item.label} className="min-w-0"><dt className="text-text-muted">{item.label}</dt><dd className="break-words">{item.value}</dd></div>)}
                </dl>}
                {media.length > 0 && <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {media.map((item, index) => <div key={`${item.label}-${index}`} className="min-w-0">
                        <div className="aspect-video overflow-hidden rounded border border-glass-border bg-surface">
                            <img src={getAssetUrl(item.url)} alt={item.label} className="h-full w-full object-cover" />
                        </div>
                        <p className="mt-1 text-xs text-text-muted">{item.label}</p>
                    </div>)}
                </div>}
                {!media.length && <p className="text-xs text-text-muted">本次无参考图或首尾帧。</p>}
                <div><h3 className="mb-2 font-medium text-foreground">提交到视频任务的正向提示词</h3>
                    <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded border border-glass-border bg-surface p-3 font-sans leading-relaxed text-text-secondary">{preview.prompt}</pre>
                </div>
                <p className="text-xs text-text-muted">请核对本镜光影和风格是否已写入正文。场景设计和一致性表中的字段不会自动补入视频任务；已保存的对白可能在服务端补充到任务文本。</p>
                {preview.negativePrompt && <div><h3 className="mb-2 font-medium text-foreground">负向提示词</h3>
                    <p className="whitespace-pre-wrap break-words text-text-secondary">{preview.negativePrompt}</p>
                </div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-glass-border px-5 py-4">
                <button type="button" onClick={onClose} className="rounded border border-glass-border px-4 py-2 text-sm text-foreground">返回修改</button>
                <button type="button" onClick={onConfirm} className="rounded bg-primary px-4 py-2 text-sm font-medium text-foreground">确认提交</button>
            </div>
        </div>
    </div>;
}
