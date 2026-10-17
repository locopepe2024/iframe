"use client";

import { useEffect, useRef, useState } from "react";
import { api, type AssetImageReviewProjection, type AssetImageReviewRequest } from "@/lib/api";
import { extractErrorDetail } from "@/lib/utils";

type Props = {
    projectId: string;
    request: AssetImageReviewRequest;
    onBack: () => void;
    onConfirm: (review: AssetImageReviewProjection) => void;
};

export default function AssetImageSubmissionReview({ projectId, request, onBack, onConfirm }: Props) {
    const [review, setReview] = useState<AssetImageReviewProjection | null>(null);
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
        api.previewAssetImageSubmission(projectId, request).then((result) => {
            if (!active) return;
            if (result.positive_prompt !== request.prompt || result.negative_prompt !== request.negative_prompt) {
                setError("预览文本与待提交文本不一致，请返回检查。 ");
                return;
            }
            setReview(result);
        }).catch((cause) => {
            if (active) setError(extractErrorDetail(cause, "无法获取提交预览"));
        });
        return () => { active = false; };
    }, [projectId, request]);

    useEffect(() => { if (review) confirmRef.current?.focus(); }, [review]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3" onKeyDown={(event) => {
            if (event.key === "Escape") onBack();
        }}>
            <section role="dialog" aria-modal="true" aria-label="核对图片生成请求"
                className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-xl border border-glass-border bg-surface p-5 shadow-2xl">
                <h2 className="text-base font-semibold text-foreground">核对图片生成请求</h2>
                <p className="mt-1 text-xs text-text-secondary">请确认这些内容与参数。返回修改后需要重新核对。</p>
                {error ? <p role="alert" className="mt-4 text-sm text-red-400">{error}</p> : !review ?
                    <p role="status" className="mt-4 text-sm text-text-secondary">正在读取实际模型与画幅…</p> : <>
                    <div className="mt-4 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                        <p>模型：<span className="text-foreground">{review.selected_model_id}</span></p>
                        <p>画幅：<span className="text-foreground">{review.aspect_ratio}</span></p>
                        <p>模式：<span className="text-foreground">{review.image_generation_mode === "reference" ? "参考生图" : "文生图"}</span></p>
                        <p>图片类型：<span className="text-foreground">{review.generation_type}</span></p>
                        <p>数量：<span className="text-foreground">{review.batch_size}</span></p>
                        <p>确认设计版本：<span className="text-foreground">{review.design_revision_at_submission ?? "未确认"}</span></p>
                    </div>
                    <div className="mt-4 space-y-3">
                        <div><h3 className="text-xs font-medium text-text-secondary">正向提示词</h3>
                            <p className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded border border-glass-border bg-surface-inset p-3 text-sm text-foreground">{review.positive_prompt}</p></div>
                        <div><h3 className="text-xs font-medium text-text-secondary">负面提示词</h3>
                            <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded border border-glass-border bg-surface-inset p-3 text-sm text-foreground">{review.negative_prompt || "无"}</p></div>
                        <div><h3 className="text-xs font-medium text-text-secondary">参考图（稳定资产与变体 ID）</h3>
                            {review.reference_inputs.length ? <ul className="mt-1 space-y-1 rounded border border-glass-border bg-surface-inset p-3 text-xs text-foreground">
                                {review.reference_inputs.map((item) => <li key={`${item.asset_type}:${item.asset_id}:${item.variant_id}`} className="break-all">
                                    {item.asset_type} · {item.asset_id} · {item.variant_id}
                                </li>)}
                            </ul> : <p className="mt-1 text-xs text-text-muted">无参考图</p>}</div>
                    </div>
                </>}
                <div className="mt-5 flex justify-end gap-2">
                    <button ref={backRef} type="button" onClick={onBack} className="rounded border border-glass-border px-4 py-2 text-sm text-text-secondary hover:text-foreground">返回修改</button>
                    <button ref={confirmRef} type="button" disabled={!review || Boolean(error)} onClick={() => review && onConfirm(review)}
                        className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">确认并生成</button>
                </div>
            </section>
        </div>
    );
}
