"use client";

import { X } from "lucide-react";
import { OPTIMIZATION_SKILLS } from "./OptimizerSelector";

export interface VideoPolishMessages {
    system: string;
    user: string;
}

interface VideoPolishReviewProps {
    messages: VideoPolishMessages;
    media: { label: string; url: string }[];
    formatNote: string;
    targetModel?: string;
    reviewContext?: {
        effective_shot_fields: Record<string, { value: unknown; source: string; revision: number | null }>;
        selected_skills: string[];
        target_duration: number | null;
    };
    isContextIr: boolean;
    isSubmitting: boolean;
    error?: string;
    userLabel?: string;
    confirmLabel?: string;
    onChange: (messages: VideoPolishMessages) => void;
    onCancel: () => void;
    onConfirm: () => void;
}

const fieldLabels: Record<string, string> = {
    duration: "时长", shot_size: "景别", camera_angle: "机位", camera_movement: "运镜",
    transition_hint: "转场", style: "风格", lighting_override: "本镜光线",
    story_time: "叙事时间", daylight_phase: "日光阶段", weather: "天气",
    shadow_direction: "阴影方向", key_source: "主光", ambient_lighting: "环境光",
    color_tone: "色调", contrast: "对比", practical_sources: "画内光源",
    direction: "光线方向", quality: "光线质感", color_temp: "色温",
};
const sourceLabels: Record<string, string> = {
    frame: "本镜", scene_design: "场景设计", scene_asset: "场景资产",
    art_direction: "美术方向", project: "项目", plan_scene: "导演场景",
    plan_baseline: "拍摄计划", plan_shot: "导演计划",
    selected_reference: "参考图",
};

function displayValue(value: unknown): string {
    if (Array.isArray(value)) return value.map(displayValue).join("、");
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value ?? "");
}

export default function VideoPolishReview({ messages, media, formatNote, targetModel, reviewContext, isContextIr,
    isSubmitting, error, userLabel = "用户／镜头文字", confirmLabel = "确认输入并润色",
    onChange, onCancel, onConfirm }: VideoPolishReviewProps) {
    const fields = Object.entries(reviewContext?.effective_shot_fields ?? {})
        .filter(([name, field]) => name in fieldLabels && field.value != null && field.value !== "");
    const skills = reviewContext?.selected_skills.map(id =>
        OPTIMIZATION_SKILLS.find(([skillId]) => skillId === id)?.[1] ?? id) ?? [];
    return <div className="space-y-3 rounded-lg border border-glass-border bg-surface-inset p-3">
        <div className="flex items-center justify-between gap-2">
            <strong className="text-sm text-foreground">提交前检查模型输入</strong>
            <button type="button" onClick={onCancel} aria-label="关闭润色输入检查" className="rounded p-1 text-text-secondary hover:text-foreground"><X size={14} /></button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
            {targetModel && <p>目标模型：<span className="text-foreground">{targetModel}</span></p>}
            {reviewContext?.target_duration != null && !fields.some(([name]) => name === "duration")
                && <p>时长：<span className="text-foreground">{reviewContext.target_duration} 秒</span></p>}
            {skills.length > 0 && <p>已选技能：<span className="text-foreground">{skills.join("、")}</span></p>}
        </div>
        <label className="block text-xs text-text-secondary">{isContextIr ? "送入 IR 的文字" : userLabel}
            <textarea aria-label={isContextIr ? "送入 IR 的文字" : userLabel} value={messages.user}
                onChange={(event) => onChange({ ...messages, user: event.target.value })}
                className="mt-1 min-h-36 w-full resize-y rounded border border-glass-border bg-surface p-2 text-sm leading-6 text-foreground" />
        </label>
        {fields.length > 0 && <section aria-label="已确认镜头字段" className="border-t border-glass-border pt-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">已确认镜头字段</h3>
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                {fields.map(([name, field]) => <div key={name} className="min-w-0 text-xs">
                    <dt className="text-text-muted">{fieldLabels[name]} · {sourceLabels[field.source] ?? field.source}{field.revision ? ` r${field.revision}` : ""}</dt>
                    <dd className="break-words text-foreground">{displayValue(field.value)}{name === "duration" ? " 秒" : ""}</dd>
                </div>)}
            </dl>
        </section>}
        <div className="border-t border-glass-border pt-3 text-xs text-text-secondary">
            <span>参考图：</span>{media.length ? <ul className="mt-1 flex flex-wrap gap-2">{media.map((item, index) =>
                <li key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2">{item.label}</a></li>)}</ul>
                : <span className="text-text-muted">无</span>}
        </div>
        {messages.system && !isContextIr && <details className="border-t border-glass-border pt-3 text-xs text-text-secondary">
            <summary className="cursor-pointer text-foreground">高级模型输入 · 完整规则</summary>
            <label className="mt-3 block">系统／任务文字
                <textarea aria-label="系统／任务文字" value={messages.system}
                    onChange={(event) => onChange({ ...messages, system: event.target.value })}
                    className="mt-1 h-56 w-full resize-y rounded border border-glass-border bg-surface p-2 font-mono text-xs leading-5 text-foreground" />
            </label>
            <p className="mt-2 text-text-muted">{formatNote}</p>
        </details>}
        {isContextIr && <p className="text-xs text-text-muted">{formatNote}</p>}
        {error && <p role="alert" className="text-xs text-status-failed-fg">{error}</p>}
        <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="rounded border border-glass-border px-3 py-1.5 text-xs text-foreground">返回</button>
            <button type="button" onClick={onConfirm} disabled={isSubmitting || !messages.user.trim()}
                className="rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50">
                {isSubmitting ? "模型处理中…" : confirmLabel}
            </button>
        </div>
    </div>;
}
