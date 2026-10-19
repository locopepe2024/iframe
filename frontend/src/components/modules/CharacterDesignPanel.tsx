"use client";

import { useRef, useState } from "react";
import type { ChatModel } from "@/lib/api";
import ReferencePromptEditor, { type PromptSlashSuggestion } from "./playground/ReferencePromptEditor";
import CharacterPromptDictionary from "./CharacterPromptDictionary";

export default function CharacterDesignPanel({ description, details, onDetailsChange, result, onResultChange,
    reviewItems, models, model, onModelChange, busy, saving, canSave, error, status, onSubmit, onSave, onConfirm, onBack,
}: {
    description: string; details: string; onDetailsChange: (value: string) => void;
    result: string | null; onResultChange: (value: string) => void;
    reviewItems: string[];
    models: ChatModel[]; model: string; onModelChange: (value: string) => void;
    busy: boolean; saving: boolean; canSave: boolean; error: string; status: string;
    onSubmit: () => void; onSave: () => void; onConfirm: () => void; onBack: () => void;
}) {
    const [slash, setSlash] = useState<PromptSlashSuggestion | null>(null);
    const [openSlashRequest, setOpenSlashRequest] = useState(0);
    const keyHandler = useRef<((event: KeyboardEvent) => boolean) | null>(null);
    return <section id="character-design-dossier" aria-label="角色设计" className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">角色设计</h3>
            <button type="button" onClick={onBack} className="min-h-11 rounded border border-glass-border px-3 text-xs hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">返回图片 Prompt</button>
        </div>
        <div className="rounded border border-glass-border p-3">
            <h4 className="text-xs font-medium text-foreground">角色描述 · 设计依据</h4>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">{description || "暂无角色描述"}</p>
            <p className="mt-2 text-[11px] text-text-muted">供设计核对，不随 AI 完善改写。</p>
        </div>
        <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-text-secondary">角色细节</span>
                <button type="button" disabled={saving} onClick={() => setOpenSlashRequest(value => value + 1)} className="min-h-11 rounded border border-glass-border px-3 text-xs hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">/ 词典和 Skill</button>
            </div>
            <p className="mb-2 text-[11px] text-text-muted">已带入当前 Prompt，可继续调整词典细节和 [] 内容后提交。</p>
            <div className="relative min-h-36 rounded border border-glass-border p-2">
                <ReferencePromptEditor value={details} onChange={onDetailsChange} candidates={[]} expanded editable={!saving}
                    placeholder="角色细节，/ 选择词典，[] 调整细节" openSlashRequest={openSlashRequest}
                    allowImplicitMentions={false} onSlashChange={setSlash}
                    onSlashKeyDown={event => keyHandler.current?.(event) || false} />
                {slash && <CharacterPromptDictionary suggestion={slash} onClose={() => setSlash(null)}
                    onApply={text => onDetailsChange(text)} keyHandler={keyHandler} canRunSkill={false} />}
            </div>
        </div>
        <label className="block text-xs text-text-secondary" htmlFor="character-design-model">设计模型</label>
        <select id="character-design-model" value={model} onChange={event => onModelChange(event.target.value)}
            disabled={!models.length || busy || saving} className="min-h-11 w-full rounded border border-glass-border bg-surface px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {!models.length && <option value="">暂无可用模型</option>}
            {models.map(item => <option key={item.api_model_id} value={item.api_model_id}>{item.display_name}</option>)}
        </select>
        <button type="button" onClick={onSubmit} disabled={!model || !description.trim() || busy || saving || details.length > 8000}
            className="min-h-11 w-full rounded bg-primary px-3 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{busy ? "完善中…" : "提交 AI 完善"}</button>
        {details.length > 8000 && <p role="alert" className="text-xs text-red-400">角色细节不能超过 8000 字，请精简后提交。</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        {result !== null && <div>
            <label htmlFor="character-design-result" className="text-xs font-medium text-foreground">角色提示词 · 检查后保存或确认</label>
            <textarea id="character-design-result" disabled={saving} value={result} onChange={event => onResultChange(event.target.value)} rows={10}
                className="mt-2 w-full resize-y rounded border border-glass-border bg-surface p-3 text-sm leading-6 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
        </div>}
        {result !== null && reviewItems.length > 0 && <div className="rounded border border-amber-400/30 p-2 text-xs text-text-secondary">
            <p className="font-medium">提示词核对事项</p>
            {reviewItems.map(item => <p key={item} className="mt-1">{item}</p>)}
        </div>}
        <p role="status" className="text-xs text-text-muted">{status}</p>
        <div className="flex gap-2">
            <button type="button" disabled={!canSave || saving || busy} onClick={onSave}
                className="min-h-11 flex-1 rounded border border-glass-border px-3 text-sm hover:bg-hover-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">保存草稿</button>
            <button type="button" disabled={!canSave || saving || busy || !(result ?? details).trim()} onClick={onConfirm}
                className="min-h-11 flex-1 rounded bg-primary px-3 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">确认设计</button>
        </div>
    </section>;
}
