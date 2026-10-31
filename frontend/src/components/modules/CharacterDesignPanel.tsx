"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Image as ImageIcon, Search, X } from "lucide-react";
import type { AssetLibraryReference, ChatModel } from "@/lib/api";
import ReferencePromptEditor, { type PromptSlashSuggestion, type ReferenceCandidate } from "./playground/ReferencePromptEditor";
import { IDENTITY_FIELDS, LOOK_FIELDS, type IdentityFeatures, type LookFeatures, type CharacterConstraints } from "@/lib/characterStructuredDesign";
import type { DictionaryConfiguration } from "@/lib/characterDictionaryPresets";
import CharacterPromptDictionary, { CharacterDictionaryHost } from "./CharacterPromptDictionary";
import { searchReferenceCandidates, selectedReferenceCandidates } from "@/lib/referenceCandidateSearch";
import { AssetIndexPreview } from "@/components/shared/AssetIndexPreview";

function DesignReferencePicker({ candidates, selected, onChange }: { candidates: ReferenceCandidate[]; selected: AssetLibraryReference[]; onChange?: (references: AssetLibraryReference[]) => void }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const keys = new Set(selected.map((item) => `${item.asset_type}:${item.asset_id}:${item.variant_id}`));
    const results = searchReferenceCandidates(candidates, query);
    const toggle = (candidate: ReferenceCandidate) => {
        if (!candidate.reference || !onChange) return;
        const key = `${candidate.reference.asset_type}:${candidate.reference.asset_id}:${candidate.reference.variant_id}`;
        onChange(keys.has(key) ? selected.filter((item) => `${item.asset_type}:${item.asset_id}:${item.variant_id}` !== key) : [...selected, candidate.reference]);
    };
    return <div className="rounded border border-glass-border bg-surface/60 p-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-h-10 w-full items-center justify-between px-2 text-left text-xs text-text-secondary hover:text-foreground">
            <span className="inline-flex items-center gap-1.5"><ImageIcon size={14} />参考素材{selected.length ? ` · ${selected.length}` : ""}</span>
            {open ? <X size={14} aria-label="关闭参考素材列表" /> : <Search size={14} />}
        </button>
        {open && <div className="mt-2">
            <input aria-label="搜索角色设计参考素材" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已加入参考素材" className="h-9 w-full rounded border border-glass-border bg-surface px-2 text-xs text-foreground" />
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto" role="listbox" aria-label="角色设计参考素材">
                {results.length === 0 ? <p className="px-2 py-2 text-xs text-text-muted">{candidates.length ? "没有匹配的参考素材" : "请先在图片面板加入参考素材"}</p> : results.map((candidate) => {
                    const key = candidate.reference ? `${candidate.reference.asset_type}:${candidate.reference.asset_id}:${candidate.reference.variant_id}` : candidate.label;
                    const checked = keys.has(key);
                    return <button type="button" role="option" aria-selected={checked} key={key} onClick={() => toggle(candidate)} className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover-bg">
                        <span className="h-7 w-7 shrink-0 overflow-hidden rounded bg-surface-inset">{candidate.previewRef ? <AssetIndexPreview asset={candidate.previewRef} /> : null}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{candidate.label}</span>{checked && <Check size={14} className="text-primary" />}
                    </button>;
                })}
            </div>
        </div>}
    </div>;
}

export default function CharacterDesignPanel({ description, details, onDetailsChange, result, onResultChange,
    identityFields, lookFields, onFieldsChange, onDictionaryFields, onDictionaryConfiguration, configurations, previousExpressionText, constraints, onConstraintsChange, supplemental, onSupplementalChange, reviewItems, models, model, onModelChange, busy, saving, canSave, canReedit, error, status, tab, onTabChange, onSubmit, onSave, onReedit, referenceCandidates = [], referenceSelections = [], onReferenceSelectionsChange,
}: {
    description: string; details: string; onDetailsChange: (value: string) => void;
    result: string | null; onResultChange: (value: string) => void;
    onDictionaryConfiguration: (configuration: DictionaryConfiguration) => void;
    configurations: DictionaryConfiguration[];
    previousExpressionText?: string;
    supplemental: string; onSupplementalChange: (value: string) => void;
    identityFields: IdentityFeatures; lookFields: LookFeatures;
    onFieldsChange: (section: "identity" | "look", key: string, value: string) => void;
    onDictionaryFields: (text: string, fields: { identity: Record<string, string>; look: Record<string, string>; constraints?: CharacterConstraints }, remainingText: string) => void;
    constraints: CharacterConstraints; onConstraintsChange: (value: CharacterConstraints) => void;
    reviewItems: string[];
    models: ChatModel[]; model: string; onModelChange: (value: string) => void;
    busy: boolean; saving: boolean; canSave: boolean; canReedit: boolean; error: string; status: string;
    tab: "design" | "ai"; onTabChange: (tab: "design" | "ai") => void;
    onSubmit: () => void; onSave: (source: "panel" | "ai") => void; onReedit: () => void;
    referenceCandidates?: ReferenceCandidate[]; referenceSelections?: AssetLibraryReference[];
    onReferenceSelectionsChange?: (references: AssetLibraryReference[]) => void;
}) {
    const [showFields, setShowFields] = useState(false);
    const host = useContext(CharacterDictionaryHost);
    const openFieldsRef = useRef<HTMLButtonElement>(null);
    const closeFieldsRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!showFields) return;
        closeFieldsRef.current?.focus();
        return () => openFieldsRef.current?.focus();
    }, [showFields]);
    const [slash, setSlash] = useState<PromptSlashSuggestion | null>(null);
    const [openSlashRequest, setOpenSlashRequest] = useState(0);
    const keyHandler = useRef<((event: KeyboardEvent) => boolean) | null>(null);
    const fieldsPanel = <div className={`${host ? 'absolute' : 'fixed'} inset-0 z-[70] flex flex-col rounded-xl border border-glass-border bg-surface p-4 shadow-2xl`}
        role="dialog" aria-modal={!host} aria-label="角色编辑" onKeyDown={event => {
            if (event.key === 'Escape') { event.stopPropagation(); setShowFields(false); }
        }}>
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
            <h3 className="text-sm font-medium">角色编辑</h3>
            <button ref={closeFieldsRef} type="button" aria-label="关闭角色编辑" onClick={() => setShowFields(false)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <div aria-label="结构化角色设计" className="space-y-3">
            {([['identity', '基础特征', IDENTITY_FIELDS.filter(([key]) => ['gender', 'age', 'height'].includes(key)), identityFields], ['identity', '面容与体态', IDENTITY_FIELDS.filter(([key]) => !['gender', 'age', 'height'].includes(key)), identityFields], ['look', '服装与配饰', LOOK_FIELDS, lookFields]] as const).map(([section, title, fields, values]) =>
                <fieldset key={title} disabled={saving || busy} className="min-w-0 rounded border border-glass-border p-3">
                    <legend className="px-1 text-xs font-medium">{title}</legend>
                    <div className={`grid grid-cols-1 gap-3 ${title === "基础特征" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                        {fields.map(([key, label]) => <label key={key} className="min-w-0 text-xs text-text-secondary">
                            {label}
                            <textarea aria-label={`设计字段 · ${label}`} rows={2} maxLength={500}
                                value={(values as Record<string, string>)[key] || ''}
                                onChange={event => onFieldsChange(section, key, event.target.value)}
                                className="mt-1 min-h-11 w-full resize-y rounded border border-glass-border bg-surface p-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
                        </label>)}
                    </div>
                </fieldset>)}
        </div>
        <fieldset disabled={saving || busy} className="min-w-0 rounded border border-glass-border p-3">
            <legend className="px-1 text-xs font-medium">设计约束</legend>
            <p className="mb-2 text-[11px] text-text-muted">角色一致性约束：必须保留的特征与需要排除的内容。保存后随角色生效，并带入出图提示词。</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([['must_keep', '必须保留'], ['negative_prompt', '负面提示词']] as const).map(([key, label]) =>
                    <label key={key} className="min-w-0 text-xs text-text-secondary">{label}
                        <textarea aria-label={`设计约束 · ${label}`} value={constraints[key].join('\n')} rows={4}
                            onChange={event => onConstraintsChange({ ...constraints, [key]: event.target.value.split('\n') })}
                            className="mt-1 min-h-11 w-full rounded border border-glass-border bg-surface p-2 text-sm text-foreground" />
                    </label>)}
            </div>
        </fieldset>
        </div>
    </div>;
    return <section id="character-design-dossier" aria-label="角色设计" className="space-y-3 p-4">
        <div role="tablist" aria-label="角色设计编辑" className="sticky top-0 z-10 flex gap-2 border-b border-glass-border bg-surface pb-2">
            {([['design', '角色设计'], ['ai', 'AI 优化']] as const).map(([id, label]) => <button
                key={id} id={`character-design-tab-${id}`} type="button" role="tab" aria-selected={tab === id}
                aria-controls={`character-design-panel-${id}`} tabIndex={tab === id ? 0 : -1}
                onClick={() => onTabChange(id)} onKeyDown={event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next = event.key === 'Home' ? 'design' : event.key === 'End' ? 'ai' : tab === 'design' ? 'ai' : 'design';
                    onTabChange(next);
                    document.getElementById(`character-design-tab-${next}`)?.focus();
                }} className={`min-h-11 flex-1 rounded px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${tab === id ? 'bg-primary/15 text-primary' : 'text-text-secondary hover:bg-hover-bg'}`}>{label}</button>)}
        </div>
        <div id="character-design-panel-design" role="tabpanel" aria-labelledby="character-design-tab-design" hidden={tab !== 'design'} className="space-y-3">
        <div className="rounded border border-glass-border p-3">
            <h4 className="text-xs font-medium text-foreground">角色描述 · 设计依据</h4>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">{description || "暂无角色描述"}</p>
            <p className="mt-2 text-[11px] text-text-muted">供设计核对，不随 AI 完善改写。</p>
        </div>
        <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-text-secondary">角色设计</span>
                <div className="flex gap-2">
                <button type="button" ref={openFieldsRef} disabled={saving || busy} onClick={() => setShowFields(true)} aria-haspopup="dialog"
                    className="min-h-11 rounded border border-glass-border px-3 text-xs hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">角色编辑</button>
                <button type="button" disabled={saving} onMouseDown={event => event.preventDefault()} onClick={() => setOpenSlashRequest(value => value + 1)} className="min-h-11 rounded border border-glass-border px-3 text-xs hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">快捷面板</button>
                </div>
            </div>
            <DesignReferencePicker candidates={referenceCandidates} selected={referenceSelections} onChange={onReferenceSelectionsChange} />
            <p className="mb-2 text-[11px] text-text-muted">可直接使用角色设计，也可先提交 AI 完善。保存会保留两份内容，当前页签决定用于出图的版本。</p>
            <div className="relative min-h-36 rounded border border-glass-border p-2">
                <ReferencePromptEditor value={details} onChange={onDetailsChange} candidates={selectedReferenceCandidates(referenceCandidates, referenceSelections)} restoreSelectedReferences={referenceSelections} onReferencesChange={onReferenceSelectionsChange} expanded editable={!saving}
                    placeholder="角色设计，/ 选择词典，[] 调整细节" openSlashRequest={openSlashRequest}
                    allowImplicitMentions={false} onSlashChange={setSlash}
                    onSlashKeyDown={event => keyHandler.current?.(event) || false} />
                {slash && <CharacterPromptDictionary suggestion={slash} onClose={() => setSlash(null)} configurations={configurations}
                    currentFields={{ identity: identityFields, look: lookFields }}
                    onConfiguration={onDictionaryConfiguration} onApply={(text, entry) => {
                        if (entry.structuredFields) onDictionaryFields(text, entry.structuredFields, entry.remainingText || "");
                        else if (entry.preset?.id === "dictionary.panel.expression") {
                            const remaining = previousExpressionText
                                ? (entry.remainingText || "").replace(previousExpressionText.trim(), "").trim() : entry.remainingText;
                            onDictionaryFields(text, { identity: {}, look: {} }, [remaining, entry.text].filter(Boolean).join("\n"));
                        } else onDetailsChange(text);
                    }} keyHandler={keyHandler} />}
            </div>
        </div>
        {supplemental && <label className="block text-xs text-text-secondary">其他已输入细节
            <textarea aria-label="其他已输入细节" value={supplemental} disabled={saving || busy} rows={3}
                onChange={event => onSupplementalChange(event.target.value)}
                className="mt-1 w-full rounded border border-glass-border bg-surface p-2 text-sm text-foreground" />
        </label>}
        <label className="block text-xs text-text-secondary" htmlFor="character-design-model">设计模型</label>
        <select id="character-design-model" value={model} onChange={event => onModelChange(event.target.value)}
            disabled={!models.length || busy || saving} className="min-h-11 w-full rounded border border-glass-border bg-surface px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {!models.length && <option value="">暂无可用模型</option>}
            {models.map(item => <option key={item.api_model_id} value={item.api_model_id}>{item.display_name}</option>)}
        </select>
        <button type="button" onClick={onSubmit} disabled={!model || !description.trim() || busy || saving || details.length > 8000}
            className="min-h-11 w-full rounded bg-primary px-3 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{busy ? "完善中…" : "提交 AI 完善"}</button>
        {details.length > 8000 && <p role="alert" className="text-xs text-red-400">角色设计不能超过 8000 字，请精简后提交。</p>}
        </div>
        <div id="character-design-panel-ai" role="tabpanel" aria-labelledby="character-design-tab-ai" hidden={tab !== 'ai'} className="space-y-3">
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        {result !== null && <div>
            <label htmlFor="character-design-result" className="sr-only">AI 优化</label>
            <textarea id="character-design-result" disabled={saving} value={result} maxLength={20000} onChange={event => onResultChange(event.target.value)} rows={10}
                className="mt-2 w-full resize-y rounded border border-glass-border bg-surface p-3 text-sm leading-6 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
        </div>}
        {result !== null && reviewItems.length > 0 && <div className="rounded border border-amber-400/30 p-2 text-xs text-text-secondary">
            <p className="font-medium">提示词核对事项</p>
            {reviewItems.map(item => <p key={item} className="mt-1">{item}</p>)}
        </div>}
        {result === null && <p className="py-4 text-sm text-text-muted">{busy ? '正在完善角色设计…' : '提交 AI 完善后，在此检查和编辑结果。'}</p>}
        </div>
        {error && tab === 'design' && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <p className="text-xs text-text-secondary">本次生成使用：{tab === 'ai' ? 'AI 优化' : '角色设计'}。点击生成后可核对和编辑实际提示词。</p>
        <p role="status" className="text-xs text-text-muted">{status}</p>
        <div className="sticky bottom-0 flex gap-2 bg-surface py-2">
            <button type="button" disabled={!canSave || saving || busy} onClick={() => onSave(tab === "ai" ? "ai" : "panel")}
                className="min-h-11 flex-1 rounded bg-primary px-3 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{saving ? "保存中…" : tab === "ai" ? "保存并使用 AI 优化" : "保存并使用角色设计"}</button>
            <button type="button" disabled={saving || busy || !canReedit} onClick={onReedit}
                className="min-h-11 flex-1 rounded border border-glass-border px-3 text-sm hover:bg-hover-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">编辑已保存设计</button>
        </div>
        {showFields && (host ? createPortal(fieldsPanel, host) : fieldsPanel)}
    </section>;
}
