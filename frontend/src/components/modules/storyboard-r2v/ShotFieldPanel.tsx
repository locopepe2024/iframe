"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";

type Review = Awaited<ReturnType<typeof api.previewShotFields>>;
type Candidate = Awaited<ReturnType<typeof api.generateShotFields>>;

const labels: Record<string, string> = {
    duration: "时长", shot_size: "景别", camera_angle: "机位",
    camera_movement_structured: "运镜", transition_hint: "转场",
    style_prompt_override: "本镜风格", lighting_override: "本镜光线",
    style: "有效风格", story_time: "叙事时间", daylight_phase: "日光阶段",
    weather: "天气", shadow_direction: "阴影方向", key_source: "主光",
    ambient_lighting: "环境光", color_tone: "色调", contrast: "对比",
    practical_sources: "画内光源", direction: "光线方向", quality: "光线质感",
    color_temp: "色温",
};
const sourceLabels: Record<string, string> = {
    scene_design: "场景设计", frame: "本镜", art_direction: "美术方向",
    project: "项目", plan_baseline: "拍摄计划", plan_shot: "导演计划",
    selected_reference: "已确认参考图",
};

function display(value: unknown): string {
    if (value == null || value === "") return "未设置";
    if (typeof value === "object") return Array.isArray(value)
        ? value.map(display).join("、")
        : Object.values(value).map(display).filter(Boolean).join(" · ");
    return String(value);
}

export default function ShotFieldPanel({ projectId, frameId, initialCandidate, effectiveFields, optimized, onBeforePreview, onApplied }: {
    projectId: string;
    frameId: string;
    initialCandidate: Candidate | null;
    effectiveFields?: Record<string, { value: unknown; source_kind: string; source_revision: number | null }>;
    optimized: boolean;
    onBeforePreview?: () => Promise<void> | void;
    onApplied?: () => Promise<void> | void;
}) {
    const [context, setContext] = useState<Review | null>(null);
    const [review, setReview] = useState<Review | null>(null);
    const [candidate, setCandidate] = useState<Candidate | null>(initialCandidate);
    const [selected, setSelected] = useState<string[]>(Object.keys(initialCandidate?.fields ?? {}));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setContext(null);
        setReview(null);
        setCandidate(initialCandidate);
        setSelected(Object.keys(initialCandidate?.fields ?? {}));
    }, [frameId, initialCandidate?.id]);

    const loadContext = async () => {
        setBusy(true);
        setError("");
        try {
            await onBeforePreview?.();
            const next = await api.previewShotFields(projectId, frameId);
            setContext(next);
            return next;
        } catch {
            setError("无法读取镜头字段与来源，请重试。");
            return null;
        } finally {
            setBusy(false);
        }
    };
    const generate = async () => {
        if (!review) return;
        setBusy(true);
        setError("");
        try {
            const next = await api.generateShotFields(projectId, frameId, review);
            setCandidate(next);
            setSelected(Object.keys(next.fields));
            setReview(null);
        } catch {
            setReview(null);
            setError("镜头字段已变化或建议无有效依据，请重新查看输入。");
        } finally {
            setBusy(false);
        }
    };
    const apply = async () => {
        if (!candidate || !selected.length) return;
        setBusy(true);
        setError("");
        try {
            await api.applyShotFields(projectId, frameId, candidate.id, selected);
            setCandidate(null);
            setContext(null);
            await onApplied?.();
        } catch {
            setError("候选已过期或完整优化稿需要重审，请重新生成。");
        } finally {
            setBusy(false);
        }
    };

    const visual = Object.entries(effectiveFields || {}).filter(([key]) => key in labels);
    return <details className="border-t border-glass-border pt-3 text-xs text-text-secondary">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 text-foreground"><Sparkles size={14} aria-hidden="true" />镜头字段与一致性</summary>
        <div className="mt-3 space-y-3">
            {visual.length > 0 && <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {visual.map(([key, item]) => <p key={key} className="min-w-0 break-words">
                    <span className="text-text-muted">{labels[key] || key} · {sourceLabels[item.source_kind] || item.source_kind}{item.source_revision ? ` r${item.source_revision}` : ""}：</span>
                    <span className="text-foreground">{display(item.value)}</span>
                </p>)}
            </div>}
            <button type="button" disabled={busy} onClick={async () => {
                const next = await loadContext();
                if (next) setReview(next);
            }} className="inline-flex items-center gap-1.5 text-primary disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}AI 建议镜头字段
            </button>
            {review && <div className="space-y-2">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-glass-border bg-surface p-2 text-[11px]">{review.messages.system}{"\n\n"}{review.messages.user}</pre>
                <button type="button" disabled={busy} onClick={generate} className="border border-primary px-2 py-1 text-primary disabled:opacity-50">确认输入并生成建议</button>
            </div>}
            {candidate && <div className="space-y-2">
                {!Object.keys(candidate.fields).length && <p>当前镜头没有需要修改的字段。</p>}
                {Object.entries(candidate.fields).map(([field, proposed]) => <label key={field} className="flex items-start gap-2">
                    <input type="checkbox" checked={selected.includes(field)} onChange={() => setSelected(items => items.includes(field)
                        ? items.filter(item => item !== field) : [...items, field])} />
                    <span className="min-w-0 break-words"><strong className="text-foreground">{labels[field] || field}</strong><br />
                        {Boolean(context?.input?.fields) && <>当前：{display((context!.input.fields as Record<string, unknown>)[field])}<br /></>}
                        建议：{display(proposed)}<br />理由：{candidate.rationale[field]}<br />
                        依据：{(candidate.source_refs[field] ?? []).join("、")}</span>
                </label>)}
                {candidate.uncertainties.map((item, index) => <p key={index} className="text-amber-400">待确认：{item}</p>)}
                <button type="button" disabled={busy || optimized || !selected.length || !candidate.id} onClick={apply}
                    className="border border-primary px-2 py-1 text-primary disabled:opacity-50">应用所选字段</button>
                {optimized && <p className="text-text-muted">当前完整优化稿需重新审阅后才能应用字段。</p>}
            </div>}
            {error && <p role="alert" className="text-red-400">{error}</p>}
        </div>
    </details>;
}
