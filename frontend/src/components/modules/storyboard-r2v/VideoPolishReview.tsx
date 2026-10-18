"use client";

import { X } from "lucide-react";

export interface VideoPolishMessages {
    system: string;
    user: string;
}

interface VideoPolishReviewProps {
    messages: VideoPolishMessages;
    media: { label: string; url: string }[];
    formatNote: string;
    isContextIr: boolean;
    isSubmitting: boolean;
    error?: string;
    onChange: (messages: VideoPolishMessages) => void;
    onCancel: () => void;
    onConfirm: () => void;
}

export default function VideoPolishReview({ messages, media, formatNote, isContextIr,
    isSubmitting, error, onChange, onCancel, onConfirm }: VideoPolishReviewProps) {
    return <div className="space-y-3 rounded-lg border border-glass-border bg-surface-inset p-3">
        <div className="flex items-center justify-between gap-2">
            <strong className="text-sm text-foreground">提交前检查模型输入</strong>
            <button type="button" onClick={onCancel} aria-label="关闭润色输入检查" className="rounded p-1 text-text-secondary hover:text-foreground"><X size={14} /></button>
        </div>
        <p className="text-xs text-text-secondary">检查并修改以下文字后确认；图片按下列顺序提交给润色模型。</p>
        {media.length ? <ul className="space-y-1 text-xs text-text-secondary">{media.map((item, index) =>
            <li key={`${item.url}-${index}`} className="break-all">{item.label}：{item.url}</li>)}</ul>
            : <p className="text-xs text-text-muted">本次润色未附参考图。</p>}
        <label className="block text-xs text-text-secondary">系统／任务文字
            <textarea aria-label="系统／任务文字" value={messages.system} disabled={isContextIr}
                onChange={(event) => onChange({ ...messages, system: event.target.value })}
                className="mt-1 h-40 w-full rounded border border-glass-border bg-surface p-2 text-xs text-foreground disabled:opacity-50" />
        </label>
        <label className="block text-xs text-text-secondary">用户／镜头文字
            <textarea aria-label="用户／镜头文字" value={messages.user}
                onChange={(event) => onChange({ ...messages, user: event.target.value })}
                className="mt-1 h-28 w-full rounded border border-glass-border bg-surface p-2 text-xs text-foreground" />
        </label>
        <p className="text-xs text-text-muted">{formatNote}</p>
        {error && <p role="alert" className="text-xs text-status-failed-fg">{error}</p>}
        <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="rounded border border-glass-border px-3 py-1.5 text-xs text-foreground">返回</button>
            <button type="button" onClick={onConfirm} disabled={isSubmitting || !messages.user.trim()}
                className="rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50">
                {isSubmitting ? "润色中…" : "确认输入并润色"}
            </button>
        </div>
    </div>;
}
