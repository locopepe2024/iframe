'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Image as ImageIcon, Loader2, Search, Upload, X } from 'lucide-react';
import { API_URL, authenticatedFetch, api, playgroundApi, type AssetLibraryReference, type ReferenceMaterial } from '@/lib/api';
import { getAssetUrl } from '@/lib/utils';
import { AssetIndexPreview, type AssetPreviewRef } from './AssetIndexPreview';

type Source = 'all' | 'upload' | 'project' | 'platform' | 'recent';
export interface MaterialCandidate {
    label: string;
    reference?: AssetLibraryReference;
    path?: string;
    previewUrl?: string;
    previewRef?: AssetPreviewRef;
    description?: string;
    sourceLabel?: string;
    type?: 'image' | 'video' | 'audio' | 'text';
}
const sources: [Source, string][] = [['all', '全部'], ['upload', '本地上传'], ['project', '项目资产'], ['platform', '平台参考库'], ['recent', '最近创作']];
export type MaterialSelection = Omit<ReferenceMaterial, 'reference'> & { reference?: AssetLibraryReference };
export const materialKey = (reference?: AssetLibraryReference) => reference ? `${reference.asset_type}:${reference.asset_id}:${reference.variant_id}` : '';
const failure = (error: any) => String(error?.response?.data?.detail || error?.message || '素材读取失败，请重试');

function PlatformThumbnail({ id }: { id: string }) {
    const [url, setUrl] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        let objectUrl = '';
        void authenticatedFetch(`${API_URL}/platform-reference-library/${encodeURIComponent(id)}/media?preview=true`, { signal: controller.signal })
            .then(async response => {
                if (!response.ok) throw new Error('Preview unavailable');
                const blob = await response.blob();
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
            }).catch(() => {});
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [id]);
    return url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={24} className="text-text-muted" />;
}

/** One browser for discovery. Hosts keep their own generation and membership rules. */
export default function ReferenceMaterialBrowser({ open, onClose, onSelect, projectId, candidates, accept = 'image', allowRecentPaths = false, recentCandidates }: {
    open: boolean;
    onClose: () => void;
    onSelect: (material: MaterialSelection, candidate: MaterialCandidate) => void | Promise<void>;
    projectId?: string;
    candidates?: MaterialCandidate[];
    accept?: 'image' | 'video' | 'all';
    allowRecentPaths?: boolean;
    recentCandidates?: MaterialCandidate[];
}) {
    const [source, setSource] = useState<Source>('all');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(0);
    const [items, setItems] = useState<MaterialCandidate[]>([]);
    const [selected, setSelected] = useState<MaterialCandidate | null>(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [total, setTotal] = useState(0);
    const [retry, setRetry] = useState(0);
    const dialog = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const upload = useRef<HTMLInputElement>(null);
    const generation = useRef(0);
    const candidateSnapshot = useRef(candidates); candidateSnapshot.current = candidates;
    const candidateSignature = JSON.stringify(candidates?.filter(item => item.reference?.asset_type !== 'platform_reference' && item.reference?.asset_type !== 'media')
        .map(item => [materialKey(item.reference), item.label, item.description]));
    const props = useRef({ onSelect, onClose });
    props.current = { onSelect, onClose };

    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        setSource('all'); setQuery(''); setPage(0); setSelected(null); setErrors([]);
        search.current?.focus();
        return () => { generation.current++; previous?.focus(); };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const version = ++generation.current;
        setLoading(true); setItems([]); setErrors([]);
        const timer = window.setTimeout(async () => {
            const pools: MaterialCandidate[] = [];
            const issues: string[] = [];
            let platformTotal = 0;
            let projectTotal = 0;
            let recentTotal = 0;
            const needle = query.trim().toLocaleLowerCase();
            const matches = (item: MaterialCandidate) => (!needle || [item.label, item.description, item.sourceLabel].join(' ').toLocaleLowerCase().includes(needle))
                && (accept === 'all' || (item.type || 'image') === accept);
            const tasks: Promise<void>[] = [];
            if (source === 'all' || source === 'project') tasks.push((async () => {
                const projectItems: MaterialCandidate[] = [];
                try {
                    if (candidateSnapshot.current) projectItems.push(...candidateSnapshot.current.filter(item => item.reference?.asset_type !== 'platform_reference' && item.reference?.asset_type !== 'media' && matches(item)));
                    else {
                        const index = projectId ? await api.getAssetReferenceIndex(projectId) : await api.getAssetLibraryIndex();
                        for (const entry of index.assets) for (const variant of entry.variants || []) {
                            const item: MaterialCandidate = { label: [entry.name, variant.display_name].filter(Boolean).join(' · '),
                                reference: { asset_type: entry.asset_type, asset_id: entry.asset_id, variant_id: variant.id },
                                path: variant.url, sourceLabel: '项目资产', description: entry.description,
                                previewRef: { source_scope: entry.source_scope, source_container_id: entry.source_container_id,
                                    asset_type: entry.asset_type, asset_id: entry.asset_id, variant_id: variant.id } };
                            if (matches(item)) projectItems.push(item);
                        }
                    }
                    projectTotal = projectItems.length;
                    pools.push(...(source === 'all' ? projectItems.slice(page * 18, (page + 1) * 18) : projectItems));
                } catch (error) { issues.push(`项目资产：${failure(error)}`); }
            })());
            if ((source === 'all' || source === 'platform') && accept !== 'video') tasks.push((async () => {
                try {
                    const catalog = await api.getPlatformReferenceLibrary(query, 'image', undefined, undefined, undefined, undefined,
                        { limit: 36, offset: page * 36, visual_only: true });
                    platformTotal = catalog.total ?? catalog.resources.length;
                    pools.push(...catalog.resources.map(resource => ({ label: resource.title, description: [resource.summary, ...(resource.tags || [])].join(' '),
                        sourceLabel: '平台参考库', previewUrl: typeof resource.payload?.thumbnail_url === 'string' ? resource.payload.thumbnail_url : undefined,
                        reference: { asset_type: 'platform_reference' as const, asset_id: resource.platform_resource_id,
                            variant_id: String(resource.revision), revision: resource.revision, source_scope: 'platform' as const } })));
                } catch (error) { issues.push(`平台参考库：${failure(error)}`); }
            })());
            if (allowRecentPaths && (source === 'recent' || source === 'all')) tasks.push((async () => {
                try {
                    const recentItems = [...(recentCandidates || []).filter(matches)];
                    const history = await playgroundApi.getHistory(100, 0);
                    for (const item of history) if (item.status === 'completed') for (const output of item.outputs) {
                        const candidate: MaterialCandidate = { label: item.prompt?.slice(0, 80) || '最近创作', path: output.media_path,
                            previewUrl: output.thumbnail_path || (output.media_type === 'video' ? undefined : output.media_path), type: output.media_type === 'video' ? 'video' : 'image', sourceLabel: '最近创作' };
                        if (matches(candidate)) recentItems.push(candidate);
                    }
                    for (const item of history) for (const path of item.input_media || []) {
                        const label = item.media_names?.[path] || path.split('/').pop()?.split('?')[0] || '历史参考素材';
                        const type = /\.(mp4|webm|mov)(?:[?#]|$)/i.test(path) ? 'video' : /\.(mp3|wav|m4a|ogg)(?:[?#]|$)/i.test(path) ? 'audio' : /\.(txt|md|json|csv|srt|vtt)(?:[?#]|$)/i.test(path) ? 'text' : 'image';
                        const candidate: MaterialCandidate = { label, path, type, sourceLabel: '最近创作' };
                        if (matches(candidate)) recentItems.push(candidate);
                    }
                    recentTotal = recentItems.length;
                    pools.push(...(source === 'all' ? recentItems.slice(page * 12, (page + 1) * 12) : recentItems));
                } catch (error) { issues.push(`最近创作：${failure(error)}`); }
            })());
            await Promise.allSettled(tasks);
            if (generation.current !== version) return;
            const seen = new Set<string>();
            const unique = pools.filter(item => { const key = materialKey(item.reference) || item.path || item.label; if (seen.has(key)) return false; seen.add(key); return true; });
            setTotal(source === 'platform' ? platformTotal : source === 'all' ? Math.max(projectTotal * 2, platformTotal, recentTotal * 3) : unique.length);
            setItems(source === 'platform' || source === 'all' ? unique : unique.slice(page * 36, (page + 1) * 36));
            setErrors(issues); setLoading(false);
        }, query ? 250 : 0);
        return () => { window.clearTimeout(timer); generation.current++; };
    }, [open, source, query, page, retry, projectId, candidateSignature, accept, allowRecentPaths, recentCandidates]);

    useEffect(() => { setSelected(null); }, [open, source, query, page]);

    if (!open || typeof document === 'undefined') return null;
    const choose = async () => {
        if (!selected || busy) return;
        setBusy(true); setErrors([]);
        try {
            const reference = selected.reference && selected.previewRef?.source_container_id
                ? { ...selected.reference, source_scope: selected.previewRef.source_scope === 'series' ? 'series' as const : 'project' as const,
                    source_container_id: selected.previewRef.source_container_id }
                : selected.reference;
            const material = reference
                ? await api.resolveReferenceMaterial(reference, projectId, selected.label)
                : { path: selected.path!, label: selected.label, reference: undefined };
            await props.current.onSelect(material, selected);
            props.current.onClose();
        } catch (error) { setErrors([failure(error)]); }
        finally { setBusy(false); }
    };
    return createPortal(<div data-agent-asset-picker className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-3" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <div ref={dialog} role="dialog" aria-modal="true" aria-label="参考素材" className="flex max-h-[85dvh] min-h-[360px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-glass-border bg-elevated shadow-xl"
            onKeyDown={event => {
                if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
                if (event.key === 'Tab') {
                    const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
                    const first = controls?.[0], last = controls?.[controls.length - 1];
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                }
            }}>
            <header className="flex shrink-0 items-center justify-between border-b border-glass-border px-4 py-2"><h2 className="text-sm font-medium">参考素材</h2><button type="button" disabled={busy} onClick={onClose} aria-label="关闭参考素材" className="grid h-11 w-11 place-items-center rounded hover:bg-hover-bg"><X size={18} /></button></header>
            <div className="shrink-0 space-y-3 border-b border-glass-border p-3">
                <div role="tablist" aria-label="素材来源" className="flex flex-wrap gap-1">{sources.filter(([value]) => allowRecentPaths || value !== 'recent').map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={source === value} onClick={() => { setSource(value); setPage(0); }} className={`min-h-11 rounded-md px-3 text-xs ${source === value ? 'bg-primary/15 text-primary' : 'text-text-secondary hover:bg-hover-bg'}`}>{label}</button>)}</div>
                <label className="relative block"><Search size={16} className="absolute left-3 top-3.5 text-text-muted" /><input ref={search} aria-label="快速搜索参考素材" placeholder="搜索名称、动作、视角，例如：举臂交叉" value={query} onKeyDown={event => {
                    if (event.key === 'ArrowDown') { event.preventDefault(); dialog.current?.querySelector<HTMLElement>('[data-material-option]')?.focus(); }
                }} onChange={event => { setQuery(event.target.value); setPage(0); }} className="h-11 w-full rounded-md border border-glass-border bg-input-bg pl-9 pr-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" /></label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={loading || busy}>
                {errors.length > 0 && <div role="alert" className="mb-3 rounded border border-status-failed-fg/30 p-3 text-xs text-status-failed-fg">{errors.map(message => <p key={message}>{message}</p>)}<button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 underline">重新加载</button></div>}
                {source === 'upload' ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-glass-border p-6"><Upload size={24} className="text-text-muted" /><p className="text-xs text-text-secondary">上传后作为本次参考素材使用</p><input ref={upload} type="file" accept={accept === 'image' ? 'image/*' : accept === 'video' ? 'video/*' : 'image/*,video/*,audio/*,.txt,.md,.csv,.json,.srt,.vtt'} className="hidden" aria-label="上传本地参考素材" disabled={busy} onChange={async event => {
                    const file = event.target.files?.[0]; if (!file) return;
                    setBusy(true); setErrors([]);
                    try {
                        const uploaded = await playgroundApi.uploadMedia(file);
                        const image = file.type.startsWith('image/');
                        if (accept === 'image' && !image) throw new Error('此工作台仅支持图片参考');
                        setSelected({ label: file.name, path: uploaded.path, type: image ? 'image' : file.type.startsWith('video/') ? 'video' : 'audio',
                            previewUrl: image ? getAssetUrl(uploaded.path) : undefined, sourceLabel: '本地上传',
                            reference: image ? { asset_type: 'media', asset_id: uploaded.media_id, variant_id: uploaded.media_id, source_scope: 'private' } : undefined });
                    } catch (error) { setErrors([failure(error)]); } finally { setBusy(false); event.target.value = ''; }
                }} /><button type="button" disabled={busy} onClick={() => upload.current?.click()} className="min-h-11 rounded-md border border-glass-border px-4 text-xs hover:bg-hover-bg">选择文件</button>{selected && <p className="text-xs text-primary">已选择：{selected.label}</p>}</div>
                : loading ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-xs text-text-muted"><Loader2 size={18} className="animate-spin" />加载参考素材…</div>
                : <><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{items.map((item, index) => {
                    const chosen = selected === item;
                    return <button key={materialKey(item.reference) || item.path || index} type="button" data-material-option aria-label={item.label} aria-pressed={chosen} onKeyDown={event => {
                        if (event.key === 'Enter') { event.preventDefault(); setSelected(item); }
                    }} onClick={() => setSelected(item)} className={`overflow-hidden rounded-lg border text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${chosen ? 'border-primary bg-primary/10' : 'border-glass-border hover:bg-hover-bg'}`}>
                        <span className="relative flex aspect-square items-center justify-center overflow-hidden bg-surface-inset">{item.previewRef ? <AssetIndexPreview asset={item.previewRef} /> : item.previewUrl || (item.type || 'image') === 'image' && item.path ? <img src={getAssetUrl(item.previewUrl || item.path!)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : item.reference?.asset_type === 'platform_reference' ? <PlatformThumbnail id={item.reference.asset_id} /> : <ImageIcon size={24} className="text-text-muted" />}{chosen && <Check size={18} className="absolute right-2 top-2 rounded bg-primary text-on-accent" />}</span>
                        <span className="block truncate px-2 pt-2 text-xs" title={item.label}>{item.label}</span><span className="block truncate px-2 pb-2 text-[11px] text-text-muted">{item.sourceLabel || '项目资产'}</span>
                    </button>;
                })}</div>{items.length === 0 && !errors.length && <p className="py-12 text-center text-xs text-text-muted">没有匹配的参考素材</p>}</>}
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-glass-border p-3">
                <div className="flex items-center gap-2 text-xs text-text-muted"><button type="button" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)} className="min-h-11 px-2 disabled:opacity-40">上一页</button><span>第 {page + 1} 页</span><button type="button" disabled={(page + 1) * 36 >= total || loading} onClick={() => setPage(value => value + 1)} className="min-h-11 px-2 disabled:opacity-40">下一页</button></div>
                <div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded px-3 text-xs hover:bg-hover-bg">取消</button><button type="button" disabled={!selected || loading || busy} onClick={() => void choose()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-xs text-on-accent disabled:opacity-40">{busy && <Loader2 size={14} className="animate-spin" />}使用参考素材</button></div>
            </footer>
        </div>
    </div>, document.body);
}
