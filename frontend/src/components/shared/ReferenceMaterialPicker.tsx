'use client';

import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { api, type AssetLibraryReference } from '@/lib/api';
import { useProjectStore } from '@/store/projectStore';
import ReferenceMaterialBrowser, { materialKey, type MaterialCandidate } from './ReferenceMaterialBrowser';

export default function ReferenceMaterialPicker({ candidates, selected, onChange, onDiscover, title = '选择参考素材', projectId, onOpen, max = 10 }: {
    candidates?: MaterialCandidate[];
    selected: AssetLibraryReference[];
    onChange?: (references: AssetLibraryReference[]) => void | Promise<void>;
    onDiscover?: (candidate: MaterialCandidate) => void;
    title?: string;
    projectId?: string;
    onOpen?: () => void;
    max?: number;
}) {
    const currentProjectId = useProjectStore(state => state.currentProject?.id);
    const [open, setOpen] = useState(false);
    const [discovered, setDiscovered] = useState<MaterialCandidate[]>([]);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const callbacks = useRef({ onDiscover }); callbacks.current = { onDiscover };
    const selectionKey = JSON.stringify(selected);
    useEffect(() => {
        let active = true;
        const missing = selected.filter(reference => ![...(candidates || []), ...discovered].some(item => materialKey(item.reference) === materialKey(reference)));
        void Promise.all(missing.map(async reference => {
            try {
                const material = await api.resolveReferenceMaterial(reference, projectId || currentProjectId);
                if (!active) return;
                const candidate = { label: material.label, path: material.path, previewUrl: material.path, reference };
                setDiscovered(previous => [...previous.filter(item => materialKey(item.reference) !== materialKey(reference)), candidate]);
                callbacks.current.onDiscover?.(candidate);
            } catch { if (active) setError('部分参考素材暂时不可用，请重新选择。'); }
        }));
        return () => { active = false; };
    // Resolve saved selections once per stable identity, not per label update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectionKey, projectId, currentProjectId]);
    const remove = async (reference: AssetLibraryReference) => {
        setSaving(true); setError('');
        try { await onChange?.(selected.filter(item => materialKey(item) !== materialKey(reference))); }
        catch (failure: any) { setError(String(failure?.response?.data?.detail || failure?.message || '参考素材保存失败，请重试')); }
        finally { setSaving(false); }
    };
    const all = [...(candidates || []), ...discovered];
    return <section className="rounded-md border border-glass-border bg-surface/60 p-2" data-reference-picker>
        <button type="button" disabled={!onChange || saving || selected.length >= max} aria-expanded={open} onClick={() => { onOpen?.(); setOpen(true); }} className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-hover-bg disabled:opacity-40"><ImageIcon size={15} /><span>{title}{selected.length ? ` · ${selected.length}/${max}` : ''}</span></button>
        {selected.length > 0 && <div className="flex flex-wrap gap-1.5 px-2 pb-1" aria-label="已选择的参考素材">{selected.map(reference => {
            const label = all.find(item => materialKey(item.reference) === materialKey(reference))?.label || `参考图 ${selected.indexOf(reference) + 1}`;
            return <button key={materialKey(reference)} type="button" aria-label={`移除参考图 ${label}`} disabled={saving} onClick={() => void remove(reference)} className="inline-flex min-h-11 max-w-full items-center gap-1 rounded border border-glass-border px-2 text-xs hover:bg-hover-bg"><span className="truncate">{label}</span><X size={12} /></button>;
        })}</div>}
        {error && <p role="alert" className="px-2 py-1 text-xs text-status-failed-fg">{error}</p>}
        {open && <ReferenceMaterialBrowser open onClose={() => setOpen(false)} projectId={projectId || currentProjectId} candidates={candidates} onSelect={async (material, candidate) => {
            if (!material.reference) throw new Error('此工作台需要可校验的图片素材');
            if (selected.length >= max) throw new Error(`最多选择 ${max} 张参考图`);
            const resolved = { ...candidate, reference: material.reference, path: material.path, previewUrl: material.path };
            await onChange?.(selected.some(item => materialKey(item) === materialKey(material.reference)) ? selected : [...selected, material.reference]);
            setDiscovered(previous => [...previous.filter(item => materialKey(item.reference) !== materialKey(material.reference)), resolved]);
            onDiscover?.(resolved);
        }} />}
    </section>;
}
