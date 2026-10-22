"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type Candidate = {
    id: string;
    items: Array<{
        character_id: string;
        emotion_intent: string;
        timing: Array<{ phase: string; visible_change: string; relative_start: number; relative_end: number }>;
        uncertainties?: string[];
        facial_channels?: Record<string, string>;
    }>;
};

type Accepted = Pick<Candidate["items"][number], "character_id" | "timing"> & { character_name?: string };
const phaseLabels: Record<string, string> = {
    trigger: "起始", change: "变化", hold: "保持", release: "落点",
};

function timingLabel(item: Accepted): string {
    return item.timing.map(phase =>
        `${phaseLabels[phase.phase] ?? phase.phase} ${Math.round(phase.relative_start * 100)}-${Math.round(phase.relative_end * 100)}%：${phase.visible_change}`,
    ).join("；");
}

interface Props {
    projectId: string;
    frameId: string;
    initialCandidate: Candidate | null;
    accepted: Accepted[];
    characterNames: Record<string, string>;
    optimized: boolean;
    onBeforePreview?: () => Promise<void> | void;
    onApplied?: () => Promise<void> | void;
}

export default function MicroExpressionPanel({ projectId, frameId, initialCandidate, accepted, characterNames, optimized, onBeforePreview, onApplied }: Props) {
    const [intent, setIntent] = useState("");
    const [visibility, setVisibility] = useState("unknown");
    const [review, setReview] = useState<{
        messages: { system: string; user: string }; review_token: string;
    } | null>(null);
    const [candidate, setCandidate] = useState<Candidate | null>(initialCandidate);
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setCandidate(initialCandidate);
        setSelected(initialCandidate?.items.map(item => item.character_id) ?? []);
        setReview(null);
    }, [frameId, initialCandidate?.id]);

    const prepare = async () => {
        setBusy(true);
        setError("");
        try {
            await onBeforePreview?.();
            const next = await api.previewMicroExpression(projectId, frameId, intent, visibility);
            setReview(next);
        } catch {
            setError("无法预览表演输入，请确认镜头时长和角色。 ");
        } finally {
            setBusy(false);
        }
    };

    const generate = async () => {
        if (!review) return;
        setBusy(true);
        setError("");
        try {
            const next = await api.generateMicroExpression(projectId, frameId, intent, visibility, review);
            setCandidate(next);
            setSelected(next.items.map(item => item.character_id));
            setReview(null);
        } catch {
            setError("微表情候选生成失败，或镜头已变化。请重新预览。 ");
        } finally {
            setBusy(false);
        }
    };

    const apply = async () => {
        if (!candidate || !selected.length) return;
        setBusy(true);
        setError("");
        try {
            await api.applyMicroExpression(projectId, frameId, candidate.id, selected);
            setCandidate(null);
            await onApplied?.();
        } catch {
            setError("候选已过期或完整优化稿需重审，请重新生成。 ");
        } finally {
            setBusy(false);
        }
    };

    return <details className="border-t border-glass-border pt-3 text-xs text-text-secondary">
        <summary className="cursor-pointer text-foreground inline-flex items-center gap-1.5">
            <Sparkles size={14} aria-hidden="true" />微表情时序
        </summary>
        <div className="mt-3 space-y-3">
            <label className="block space-y-1">
                <span>本镜表演目标</span>
                <input value={intent} onChange={event => { setIntent(event.target.value); setReview(null); }}
                    className="w-full rounded border border-glass-border bg-surface px-2 py-1.5 text-foreground"
                    placeholder="例如：听到脚步声后克制地警觉" maxLength={500} />
            </label>
            <label className="block space-y-1">
                <span>面部可见性</span>
                <select value={visibility} onChange={event => { setVisibility(event.target.value); setReview(null); }}
                    className="w-full rounded border border-glass-border bg-surface px-2 py-1.5 text-foreground">
                    <option value="unknown">未确认</option>
                    <option value="close">清晰近景</option>
                    <option value="medium">中景可见</option>
                    <option value="wide">远景</option>
                    <option value="occluded">面部遮挡</option>
                </select>
            </label>
            <button type="button" onClick={prepare} disabled={busy}
                className="inline-flex items-center gap-1.5 text-primary disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}预览模型输入
            </button>
            {review && <div className="space-y-2">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-glass-border bg-surface p-2 text-[11px] text-text-secondary">{review.messages.system}{"\n\n"}{review.messages.user}</pre>
                <button type="button" onClick={generate} disabled={busy}
                    className="rounded border border-primary px-2 py-1 text-primary disabled:opacity-50">确认并生成候选</button>
            </div>}
            {candidate && <div className="space-y-2">
                {candidate.items.map(item => <label key={item.character_id} className="flex items-start gap-2">
                    <input type="checkbox" checked={selected.includes(item.character_id)}
                        onChange={() => setSelected(current => current.includes(item.character_id)
                            ? current.filter(id => id !== item.character_id) : [...current, item.character_id])} />
                    <span className="min-w-0 break-words"><strong>{characterNames[item.character_id] || "当前角色"}</strong> · {item.emotion_intent}<br />
                        {timingLabel(item)}</span>
                </label>)}
                {candidate.items.flatMap(item => (item.uncertainties ?? []).map((uncertainty, index) =>
                    <p key={`${item.character_id}-${index}`} className="text-amber-600">{characterNames[item.character_id] || "当前角色"}：{uncertainty}</p>
                ))}
                <button type="button" onClick={apply} disabled={busy || optimized || !selected.length}
                    className="rounded border border-primary px-2 py-1 text-primary disabled:opacity-50">应用所选角色</button>
                {optimized && <span className="ml-2 text-text-muted">当前完整优化稿需重新审阅</span>}
            </div>}
            {accepted.length > 0 && <div className="space-y-1 border-t border-glass-border pt-2">
                <p className="text-foreground">已采纳的表演时序</p>
                {accepted.map(item => <p key={item.character_id} className="break-words">
                    <strong>{item.character_name || characterNames[item.character_id] || "当前角色"}</strong> · {timingLabel(item)}
                </p>)}
            </div>}
            {error && <p role="alert" className="text-red-500">{error}</p>}
        </div>
    </details>;
}
