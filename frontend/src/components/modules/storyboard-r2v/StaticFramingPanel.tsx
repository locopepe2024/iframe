"use client";

import { useEffect, useState } from "react";
import { Focus, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type Candidate = {
    id: string;
    fields: Record<string, string>;
    current_fields: Record<string, string | null>;
    rationale: Record<string, string>;
    source_refs: Record<string, string[]>;
    uncertainties: string[];
};
type Review = { messages: { system: string; user: string }; review_token: string };
const labels: Record<string, string> = { shot_size: "景别", camera_angle: "机位", composition: "构图" };

interface Props {
    projectId: string;
    frameId: string;
    initialCandidate: Candidate | null;
    current: { shot_size?: string | null; camera_angle?: string | null; composition?: string | null };
    optimized: boolean;
    onBeforePreview?: () => Promise<void> | void;
    onGenerated?: (candidate: Candidate) => void;
    onApplied?: (updatedProject: any) => Promise<void> | void;
}

export default function StaticFramingPanel({ projectId, frameId, initialCandidate, current, optimized, onBeforePreview, onGenerated, onApplied }: Props) {
    const [review, setReview] = useState<Review | null>(null);
    const [candidate, setCandidate] = useState<Candidate | null>(initialCandidate);
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setCandidate(initialCandidate);
        setSelected(Object.keys(initialCandidate?.fields ?? {}));
        setReview(null);
    }, [frameId, initialCandidate?.id]);

    const prepare = async () => {
        setBusy(true);
        setError("");
        try {
            await onBeforePreview?.();
            setReview(await api.previewStaticFraming(projectId, frameId));
        } catch {
            setError("无法预览静态起幅输入，请检查当前镜头。");
        } finally {
            setBusy(false);
        }
    };
    const generate = async () => {
        if (!review) return;
        setBusy(true);
        setError("");
        try {
            const next = await api.generateStaticFraming(projectId, frameId, review);
            setCandidate(next);
            onGenerated?.(next);
            setSelected(Object.keys(next.fields));
            setReview(null);
        } catch {
            setError("静态起幅候选生成失败或镜头已变化，请重新预览。");
        } finally {
            setBusy(false);
        }
    };
    const apply = async () => {
        if (!candidate || !selected.length) return;
        setBusy(true);
        setError("");
        try {
            const updatedProject = await api.applyStaticFraming(projectId, frameId, candidate.id, selected);
            setCandidate(null);
            await onApplied?.(updatedProject);
        } catch {
            setError("候选已过期或完整优化稿需重审，请重新生成。");
        } finally {
            setBusy(false);
        }
    };

    return <details className="border-t border-glass-border pt-3 text-xs text-text-secondary">
        <summary className="cursor-pointer text-foreground inline-flex items-center gap-1.5"><Focus size={14} aria-hidden="true" />静态起幅</summary>
        <div className="mt-3 space-y-3">
            <p>景别：{current.shot_size || "未设置"} · 机位：{current.camera_angle || "未设置"}</p>
            {current.composition && <p className="break-words">构图：{current.composition}</p>}
            <button type="button" onClick={prepare} disabled={busy} className="inline-flex items-center gap-1.5 text-primary disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Focus size={13} />}预览模型输入
            </button>
            {review && <div className="space-y-2">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-glass-border bg-surface p-2 text-[11px]">{review.messages.system}{"\n\n"}{review.messages.user}</pre>
                <button type="button" onClick={generate} disabled={busy} className="rounded border border-primary px-2 py-1 text-primary disabled:opacity-50">确认并生成候选</button>
            </div>}
            {candidate && <div className="space-y-2">
                {Object.entries(candidate.fields).map(([field, proposed]) => <label key={field} className="flex items-start gap-2">
                    <input type="checkbox" checked={selected.includes(field)} aria-label={`采纳${labels[field] ?? field}`}
                        onChange={() => setSelected(value => value.includes(field) ? value.filter(item => item !== field) : [...value, field])} />
                    <span className="min-w-0 break-words"><strong className="text-foreground">{labels[field] ?? field}</strong><br />
                        当前：{candidate.current_fields[field] || "未设置"}<br />
                        建议：{proposed}<br />
                        理由：{candidate.rationale[field]}<br />
                        依据：{(candidate.source_refs[field] ?? []).join("、")}</span>
                </label>)}
                {candidate.uncertainties.map((item, index) => <p key={index} className="text-amber-600">待确认：{item}</p>)}
                <button type="button" onClick={apply} disabled={busy || optimized || !selected.length}
                    className="rounded border border-primary px-2 py-1 text-primary disabled:opacity-50">应用所选字段</button>
                {optimized && <span className="ml-2 text-text-muted">当前完整优化稿需重新审阅</span>}
            </div>}
            {error && <p role="alert" className="text-red-500">{error}</p>}
        </div>
    </details>;
}
