"use client";

import { useEffect, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type Movement = { primary: string; secondary?: string | null; speed: string; description?: string | null };
type Candidate = { id: string; camera_movement_structured: Movement; rationale: string; source_refs: string[]; uncertainties: string[] };
type Review = { messages: { system: string; user: string }; review_token: string };

function movementLabel(value: Movement | null | undefined) {
    if (!value) return "未设置";
    return [value.primary, value.secondary, value.speed, value.description].filter(Boolean).join(" · ");
}

interface Props {
    projectId: string;
    frameId: string;
    current: Movement | null;
    initialCandidate: Candidate | null;
    optimized: boolean;
    onBeforePreview?: () => Promise<void> | void;
    onApplied?: () => Promise<void> | void;
}

export default function CameraMovementPanel({ projectId, frameId, current, initialCandidate, optimized, onBeforePreview, onApplied }: Props) {
    const [review, setReview] = useState<Review | null>(null);
    const [candidate, setCandidate] = useState<Candidate | null>(initialCandidate);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setCandidate(initialCandidate);
        setReview(null);
    }, [frameId, initialCandidate?.id]);

    const prepare = async () => {
        setBusy(true);
        setError("");
        try {
            await onBeforePreview?.();
            setReview(await api.previewCameraMovement(projectId, frameId));
        } catch {
            setError("无法预览运镜输入，请检查当前镜头。");
        } finally {
            setBusy(false);
        }
    };
    const generate = async () => {
        if (!review) return;
        setBusy(true);
        setError("");
        try {
            setCandidate(await api.generateCameraMovement(projectId, frameId, review));
            setReview(null);
        } catch {
            setError("运镜候选生成失败或镜头已变化，请重新预览。");
        } finally {
            setBusy(false);
        }
    };
    const apply = async () => {
        if (!candidate) return;
        setBusy(true);
        setError("");
        try {
            await api.applyCameraMovement(projectId, frameId, candidate.id);
            setCandidate(null);
            await onApplied?.();
        } catch {
            setError("候选已过期或完整优化稿需重审，请重新生成。");
        } finally {
            setBusy(false);
        }
    };

    return <details className="border-t border-glass-border pt-3 text-xs text-text-secondary">
        <summary className="cursor-pointer text-foreground inline-flex items-center gap-1.5"><Camera size={14} aria-hidden="true" />运镜设计</summary>
        <div className="mt-3 space-y-3">
            <p>当前运镜：{movementLabel(current)}</p>
            <button type="button" onClick={prepare} disabled={busy} className="inline-flex items-center gap-1.5 text-primary disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}预览模型输入
            </button>
            {review && <div className="space-y-2">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-glass-border bg-surface p-2 text-[11px]">{review.messages.system}{"\n\n"}{review.messages.user}</pre>
                <button type="button" onClick={generate} disabled={busy} className="rounded border border-primary px-2 py-1 text-primary disabled:opacity-50">确认并生成候选</button>
            </div>}
            {candidate && <div className="space-y-2">
                <p className="text-foreground">建议运镜：{movementLabel(candidate.camera_movement_structured)}</p>
                <p>理由：{candidate.rationale}</p>
                <p>依据：{candidate.source_refs.join("、")}</p>
                {candidate.uncertainties.map((item, index) => <p key={index} className="text-amber-600">待确认：{item}</p>)}
                <button type="button" onClick={apply} disabled={busy || optimized} className="rounded border border-primary px-2 py-1 text-primary disabled:opacity-50">应用运镜</button>
                {optimized && <span className="ml-2 text-text-muted">当前完整优化稿需重新审阅</span>}
            </div>}
            {error && <p role="alert" className="text-red-500">{error}</p>}
        </div>
    </details>;
}
