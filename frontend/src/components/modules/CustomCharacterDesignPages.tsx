"use client";

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Plus, X } from 'lucide-react';
import { api, type AssetImageReviewRequest, type AssetLibraryReference, type AssetReferenceIndexEntry } from '@/lib/api';
import { characterDesignPageSeed, referenceDesignPrompt, updateDesignPageReferences, designReferenceKey, type CharacterDesignPage } from '@/lib/characterDesignPages';
import AssetImageSubmissionReview from '@/components/shared/AssetImageSubmissionReview';
import { toast } from '@/store/toastStore';
import type { MaterialCandidate } from '@/components/shared/ReferenceMaterialBrowser';

type Props = {
    asset: any;
    project: any;
    seriesId?: string;
    modelName?: string;
    activeId: string;
    onActivate: (id: `design:${string}` | 'full_body') => void;
    tabHost: HTMLDivElement | null;
    Panel: ComponentType<any>;
    referenceIndex: AssetReferenceIndexEntry[];
    candidates: MaterialCandidate[];
    onDiscover: (candidate: MaterialCandidate) => void;
    onRefreshReferences: () => void;
    onSave?: (attributes: Record<string, unknown>) => void | Promise<void>;
    onGenerate: (type: string, prompt: string, applyStyle: boolean, negative: string, batchSize: number, references?: AssetLibraryReference[], mode?: 'text' | 'reference', fingerprint?: string) => void;
    generatingTypes: Array<{ type: string; batchSize?: number }>;
    previewLocator: any;
    onDelete: (id: string) => Promise<void>;
    onFavorite: (id: string, favorite: boolean) => Promise<void>;
    onRename: (id: string, name: string) => Promise<void>;
};

export default function CustomCharacterDesignPages(props: Props) {
    const { asset, project, activeId, onActivate, tabHost, Panel, onSave, generatingTypes } = props;
    const [pages, setPages] = useState<CharacterDesignPage[]>(asset.custom_design_pages || []);
    const pagesRef = useRef(pages);
    const [saving, setSaving] = useState(false);
    const busy = useRef(false);
    const [error, setError] = useState('');
    const [reviewBase, setReviewBase] = useState<AssetImageReviewRequest | null>(null);
    const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null);
    const referenceVersion = useRef(0);
    const [readingReferences, setReadingReferences] = useState(false);
    const replace = (next: CharacterDesignPage[]) => { pagesRef.current = next; setPages(next); };
    const update = (id: string, patch: Partial<CharacterDesignPage>) => replace(pagesRef.current.map(page => page.id === id ? { ...page, ...patch } : page));
    useEffect(() => { referenceVersion.current++; replace(asset.custom_design_pages || []); setError(''); setReviewBase(null); setReadingReferences(false); }, [asset.id]);
    const selected = pages.find(page => `design:${page.id}` === activeId);
    const persist = async (next = pagesRef.current) => {
        if (!onSave) throw new Error('当前角色不支持保存设计页，请从资产工作台重新打开。');
        await onSave({ custom_design_pages: next });
    };
    const operation = async (work: () => Promise<void>) => {
        if (busy.current) return;
        busy.current = true; setSaving(true); setError('');
        try { await work(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : '设计页保存失败，请重试。'); }
        finally { busy.current = false; setSaving(false); }
    };
    const add = () => operation(async () => {
        const seed = characterDesignPageSeed(project, asset);
        const page: CharacterDesignPage = { id: `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            name: `设计 ${pagesRef.current.length + 1}`, prompt: seed.prompt, negative_prompt: '', mode: 'text',
            references: [], reference_prompts: {}, prompt_source: seed.source };
        const next = [...pagesRef.current, page];
        await persist(next); replace(next); onActivate(`design:${page.id}`);
        requestAnimationFrame(() => tabHost?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
    });
    const generating = (id: string) => generatingTypes.find(task => task.type === `design:${id}` || task.type === 'all');
    const close = (id: string) => operation(async () => {
        referenceVersion.current++; setReadingReferences(false);
        const next = pagesRef.current.filter(page => page.id !== id);
        await persist(next); replace(next);
        if (activeId === `design:${id}`) {
            onActivate('full_body');
            requestAnimationFrame(() => tabHost?.closest('[role="tablist"]')?.querySelector<HTMLElement>('[role="tab"]')?.focus());
        }
    });
    const selectReferences = async (id: string, references: AssetLibraryReference[]) => {
        const version = ++referenceVersion.current;
        setError('');
        const before = pagesRef.current.find(page => page.id === id);
        if (!before) return;
        setReadingReferences(true);
        try {
        const imported: Record<string, string> = {};
        for (const reference of references) {
            const key = designReferenceKey(reference);
            if (before.reference_prompts?.[key]) continue;
            const material = await api.resolveReferenceMaterial(reference, project?.id);
            imported[key] = referenceDesignPrompt(reference, props.referenceIndex, material.context);
        }
        if (version !== referenceVersion.current) return;
        const latest = pagesRef.current.find(page => page.id === id);
        if (latest) update(id, updateDesignPageReferences(latest, references, imported));
        } finally {
            if (version === referenceVersion.current) setReadingReferences(false);
        }
    };
    const beginReview = (page: CharacterDesignPage, count: number) => operation(async () => {
        if (readingReferences) throw new Error('正在读取参考图描述，请稍候。');
        if (!page.prompt.trim()) throw new Error('请填写设计页提示词。');
        await persist();
        setReviewBase({ asset_id: asset.id, asset_type: 'character', generation_type: `design:${page.id}`,
            prompt: page.prompt, negative_prompt: page.negative_prompt, batch_size: count, model_name: props.modelName,
            image_generation_mode: page.mode, references: page.mode === 'reference' ? page.references : [], apply_style: false, preserve_prompt: true });
    });
    const reviewPage = reviewBase && pages.find(page => `design:${page.id}` === reviewBase.generation_type);
    const request = useMemo(() => reviewBase && reviewPage ? { ...reviewBase, prompt: reviewPage.prompt,
        negative_prompt: reviewPage.negative_prompt, image_generation_mode: reviewPage.mode,
        references: reviewPage.mode === 'reference' ? reviewPage.references : [] } : null, [reviewBase, reviewPage]);
    const reviewError = request?.image_generation_mode === 'reference' && !request.references?.length ? '请选择至少一张参考素材，或切换为文生图。' : '';
    const tabs = <>
        {pages.map(page => <div key={page.id} className="flex shrink-0 items-center">
            <button type="button" role="tab" aria-selected={activeId === `design:${page.id}`} tabIndex={activeId === `design:${page.id}` ? 0 : -1}
                onClick={() => onActivate(`design:${page.id}`)} onKeyDown={event => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    const all = Array.from(tabHost?.closest('[role="tablist"]')?.querySelectorAll<HTMLElement>('[role="tab"]') || []);
                    const next = all[(all.indexOf(event.currentTarget) + (event.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
                    next?.click(); next?.focus();
                }} className={`min-h-11 max-w-40 truncate border-b-2 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activeId === `design:${page.id}` ? 'border-primary text-primary' : 'border-transparent text-text-secondary'}`}>{page.name || '新设计'}</button>
            <button type="button" aria-label={`关闭设计页 ${page.name || '新设计'}`} disabled={saving || !!generating(page.id)} onClick={() => void close(page.id)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-muted hover:text-foreground disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><X size={14} /></button>
        </div>)}
        <button type="button" aria-label="增加设计页" disabled={saving || !onSave} onClick={() => void add()}
            className="flex min-h-11 shrink-0 items-center gap-1 px-3 text-sm text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">增加 <Plus size={16} /></button>
    </>;
    return <>
        {tabHost && createPortal(tabs, tabHost)}
        {error && <p role="alert" className="px-4 py-2 text-sm text-status-failed-fg">{error}</p>}
        {readingReferences && selected && <p role="status" className="px-4 py-2 text-xs text-text-secondary">正在继承参考图描述…</p>}
        {selected && <Panel key={selected.id} title={selected.name} assetScope={asset.id} previewLocator={props.previewLocator} hideTitle isActive onClick={() => {}}
            designEditor={<div className="space-y-3 p-4">
                <label className="block text-xs text-text-secondary">设计页名称<input aria-label="设计页名称" value={selected.name} maxLength={120} onChange={event => update(selected.id, { name: event.target.value })}
                    className="mt-1 min-h-11 w-full rounded border border-glass-border bg-surface px-3 text-sm text-foreground" /></label>
                <p className="text-xs text-text-muted">提示词来源：{selected.prompt_source} · 可自由修改服装、动作和构图。</p>
                {!editorHost && <><label className="block text-xs text-text-secondary">设计页提示词<textarea aria-label="设计页提示词" rows={10} value={selected.prompt}
                    onChange={event => update(selected.id, { prompt: event.target.value })} className="mt-1 w-full rounded border border-glass-border bg-surface p-3 text-sm text-foreground" /></label>
                    <label className="block text-xs text-text-secondary">设计页负面提示词<textarea aria-label="设计页负面提示词" rows={3} value={selected.negative_prompt}
                        onChange={event => update(selected.id, { negative_prompt: event.target.value })} className="mt-1 w-full rounded border border-glass-border bg-surface p-3 text-sm text-foreground" /></label>
                    <button type="button" disabled={saving} onClick={() => void operation(async () => { await persist(); toast.success('设计页已保存'); })}
                        className="min-h-11 rounded border border-glass-border px-3 text-sm disabled:opacity-40">{saving ? '保存中…' : '保存设计页'}</button>
                    <p className="text-xs text-text-muted">关闭页面会移除本页草稿，已生成图片仍保留在角色素材中。</p></>}
            </div>}
            reviewEditorHost={editorHost}
            imageSettings={<div className="p-4"><label className="text-xs text-text-secondary">设计页负面提示词<textarea aria-label="设计页负面提示词" rows={3} value={selected.negative_prompt}
                onChange={event => update(selected.id, { negative_prompt: event.target.value })} className="mt-1 w-full rounded border border-glass-border bg-surface p-3 text-sm text-foreground" /></label></div>}
            asset={{ variants: (asset.full_body_asset?.variants || []).filter((variant: any) => variant.design_page_id === selected.id), selected_id: selected.selected_variant_id }}
            onSelect={(id: string) => void operation(async () => { const next = pagesRef.current.map(page => page.id === selected.id ? { ...page, selected_variant_id: id } : page); await persist(next); replace(next); })}
            onDelete={props.onDelete} onFavorite={props.onFavorite} onRename={props.onRename} markedVariantId={asset.cover_variant_id}
            prompt={selected.prompt} setPrompt={(prompt: string) => update(selected.id, { prompt })}
            referenceCandidates={props.candidates} onReferenceCandidate={props.onDiscover} onRefreshReferences={props.onRefreshReferences}
            onReferencesChange={(references: AssetLibraryReference[]) => void selectReferences(selected.id, references).catch(() => setError('参考图描述读取失败，请重试选择。'))}
            showReferencePicker effectiveReferences={selected.mode === 'reference' ? selected.references : []} pickerReferences={selected.references}
            onPickerReferencesChange={(references: AssetLibraryReference[]) => selectReferences(selected.id, references)}
            imageGenerationMode={selected.mode} onImageGenerationModeChange={(mode: 'text' | 'reference') => update(selected.id, { mode })}
            onGenerate={(count: number) => void beginReview(selected, count)} isGenerating={saving || readingReferences || !!generating(selected.id)} generatingBatchSize={generating(selected.id)?.batchSize || 1} aspectRatio="9:16" />}
        {request && (props.seriesId || project?.id) && <AssetImageSubmissionReview projectId={props.seriesId || project.id} scope={props.seriesId ? 'series' : 'project'}
            request={request} validationError={reviewError} referenceIndex={props.referenceIndex}
            editor={<><p className="mt-3 text-xs text-text-secondary">下方内容为本页实际提交提示词，可继续修改。</p><div ref={setEditorHost} className="relative mt-3" />{error && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}</>}
            onBack={() => setReviewBase(null)} onConfirm={review => void operation(async () => {
                await persist(); setReviewBase(null);
                props.onGenerate(request.generation_type, request.prompt, false, request.negative_prompt, request.batch_size, request.references || [], request.image_generation_mode, review.fingerprint);
            })} />}
    </>;
}
