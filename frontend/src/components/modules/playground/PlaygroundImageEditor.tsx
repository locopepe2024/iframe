'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { Box, ImagePlus, Plus, RefreshCw } from 'lucide-react';
import { playgroundApi, type PlaygroundGenerationResponse } from '@/lib/api';
import { imageEditorApi, type EditSource, type ImageProjectionType, type SavedImageEdit } from '@/lib/imageEditor';
import { usePlaygroundStore } from './usePlaygroundStore';
import { toast } from '@/store/toastStore';
import ImageEditorReferenceTools, { PANORAMA_PROMPT_PREFIX, type EditorReference, type GeneratedResultOptions } from './ImageEditorReferenceTools';
import { eligiblePanoramaHandoff, stagePanoramaHandoff } from '@/components/director3d/state/panorama-handoff';

const ImageEditor = dynamic(() => import('@/components/shared/image-editor/ImageEditor'), { ssr: false });
const EditorContext = createContext<((reference?: string, title?: string) => void) | null>(null);
export const usePlaygroundImageEditor = () => useContext(EditorContext);

export function ImageEditorButton() {
  const open = usePlaygroundImageEditor();
  const t = useTranslations('imageEditor');
  return <button type="button" onClick={() => open?.()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-glass-border px-3 text-sm hover:bg-hover-bg"><ImagePlus size={18} /><span>{t('title')}</span></button>;
}

function EditorSession({ reference, title, sessionId, onClose }: { reference?: string; title: string; sessionId: string | null; onClose: () => void }) {
  const t = useTranslations('imageEditor');
  const [selected, setSelected] = useState(reference);
  const [name, setName] = useState(title);
  const [loaded, setLoaded] = useState<{ source: EditSource; url: string; blob: Blob } | null>(null);
  const [copies, setCopies] = useState<SavedImageEdit[]>([]);
  const copiesRef = useRef<SavedImageEdit[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [references, setReferences] = useState<EditorReference[]>(reference ? [{ path: reference, title }] : []);
  const [generation, setGeneration] = useState<PlaygroundGenerationResponse | null>(null);
  const [history, setHistory] = useState<PlaygroundGenerationResponse[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const loadHistory = useCallback(async (offset: number) => {
    setHistoryLoading(true); setHistoryError(false);
    try {
      const records = await playgroundApi.getHistory(100, offset);
      const images = records.filter(item => (item.mode === 't2i' || item.mode === 'i2i') && item.status === 'completed' && item.outputs.some(output => output.media_type === 'image'));
      setHistory(current => offset === 0 ? images : [...current, ...images]);
      setHistoryOffset(offset + records.length);
      setHasMoreHistory(records.length === 100);
    } catch { setHistoryError(true); }
    finally { setHistoryLoading(false); }
  }, []);
  const refreshHistory = useCallback(async () => {
    await loadHistory(0);
  }, [loadHistory]);
  const updateGeneration = useCallback((next: PlaygroundGenerationResponse | null) => {
    setGeneration(next);
    if (next?.status === 'completed') void refreshHistory();
  }, [refreshHistory]);
  const [panoramaCandidatePath, setPanoramaCandidatePath] = useState<string | null>(null);
  const [hasUnsavedEdit, setHasUnsavedEdit] = useState(false);
  const retry = useRef<{ hash: string; key: string }>();
  useEffect(() => { imageEditorApi.list().then(records => { copiesRef.current = records; setCopies(records); }).catch(() => setError(t('historyFailed'))); }, [t]);
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController(); let objectUrl: string | undefined;
    setError(''); setBusy(true); setLoaded(null); setHasUnsavedEdit(false);
    imageEditorApi.load(selected, abort.signal).then(({ source, blob }) => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setLoaded({ source, url: objectUrl, blob });
    }).catch(() => { if (!abort.signal.aborted) setError(t('loadFailed')); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected, t]);
  const append = (record: SavedImageEdit) => {
    const state = usePlaygroundStore.getState();
    if (state.activeSessionId === sessionId) {
      state.setInputMedia([...state.inputMedia, record.path]);
      state.rememberMediaName(record.path, record.title);
      return true;
    }
    return false;
  };
  const addReference = (candidate: EditorReference) => {
    if (!selected) { setSelected(candidate.path); setName(candidate.title); }
    setReferences(current => {
      if (current.length >= 9 || current.some(item => item.path === candidate.path)) return current;
      let title = candidate.title;
      let suffix = 2;
      while (current.some(item => item.title === title)) title = `${candidate.title} (${suffix++})`;
      return [...current, { ...candidate, title }];
    });
  };
  const moveReference = (path: string, direction: -1 | 1) => setReferences(current => {
    const index = current.findIndex(item => item.path === path);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const useResult = (path: string, resultTitle: string, options?: GeneratedResultOptions) => {
    if (path === selected) { setPanoramaCandidatePath(options?.panoramaCandidate ? path : null); return; }
    if (hasUnsavedEdit && !window.confirm(t('discard'))) return;
    setPanoramaCandidatePath(options?.panoramaCandidate ? path : null);
    setName(resultTitle); setSelected(path);
  };
  const referenceTools = <ImageEditorReferenceTools references={references}
    onAdd={addReference} onRemove={path => setReferences(current => current.filter(item => item.path !== path))}
    onMove={moveReference} onUseResult={useResult} onGenerationChange={updateGeneration}/>;
  const saveFile = async (file: File, projection: ImageProjectionType = 'perspective_plane') => {
    if (!loaded) throw new Error('No source');
    const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('') + file.name + projection;
    if (retry.current?.hash !== hash) retry.current = { hash, key: crypto.randomUUID() };
    const saved = projection === 'perspective_plane'
      ? await imageEditorApi.save(loaded.source, file, retry.current.key)
      : await imageEditorApi.save(loaded.source, file, retry.current.key, projection);
    append(saved); copiesRef.current = [saved, ...copiesRef.current.filter(copy => copy.id !== saved.id)]; setCopies(copiesRef.current);
    toast.success(t('saved')); setPanoramaCandidatePath(null); setName(saved.title); setSelected(saved.path);
  };
  const isPanoramaCandidate = Boolean(loaded && selected === panoramaCandidatePath);
  const hasPanoramaRatio = Boolean(loaded && loaded.source.width === 2 * loaded.source.height);
  const panoramaQualityStatus = loaded?.source.panorama_quality?.status;
  const queuedOutputs = history.flatMap(item => item.outputs
    .filter(output => output.media_type === 'image' && output.media_path !== selected)
    .map(output => ({ generation: item, output })));
  return <ImageEditor source={loaded?.url} title={name} onClose={onClose} initialView={isPanoramaCandidate ? 'panorama' : 'preview'} panoramaCandidate={isPanoramaCandidate} panoramaQualityStatus={isPanoramaCandidate ? panoramaQualityStatus : undefined}
    onModified={() => setHasUnsavedEdit(true)}
    onDiscard={() => setHasUnsavedEdit(false)}
    panoramaEligible={hasPanoramaRatio || isPanoramaCandidate} panoramaSaveEligible={hasPanoramaRatio}
    onSavePanoramaSource={loaded && !hasUnsavedEdit && hasPanoramaRatio ? async () => {
      const ext = loaded.source.mime === 'image/jpeg' ? 'jpg' : loaded.source.mime === 'image/webp' ? 'webp' : 'png';
      await saveFile(new File([loaded.blob], `${name.replace(/\.[^.]+$/, '') || 'panorama'}.${ext}`, { type: loaded.source.mime }), 'equirectangular');
    } : undefined}
    leftPanel={<div className="space-y-1 text-xs">
      <div className="flex items-center justify-between px-2 pt-2"><h3 className="font-semibold text-text-muted">{t('generationHistory')}</h3><button type="button" title={t('refreshHistory')} aria-label={t('refreshHistory')} disabled={historyLoading} onClick={() => void refreshHistory()} className="grid h-9 w-9 place-items-center rounded hover:bg-hover-bg disabled:opacity-40"><RefreshCw size={15}/></button></div>
      {historyError && <p role="alert" className="px-2 text-status-failed-fg">{t('generationHistoryFailed')}</p>}
      {!historyLoading && !historyError && queuedOutputs.length === 0 && <p className="px-2 text-text-muted">{t('generationHistoryEmpty')}</p>}
      {queuedOutputs.map(({ generation: item, output }) => {
        const candidate = item.prompt.startsWith(PANORAMA_PROMPT_PREFIX);
        const label = candidate ? t('panoramaGeneration') : item.prompt || t('generatedImage');
        return <div key={`${item.id}:${output.id}`} className="flex min-w-0 items-center gap-1">
          <button type="button" onClick={() => useResult(output.media_path, label, candidate ? { panoramaCandidate: true } : undefined)} title={label} className="min-h-10 min-w-0 flex-1 truncate rounded px-2 text-left hover:bg-hover-bg">{label}</button>
          <button type="button" title={t('addReference')} aria-label={`${t('addReference')} ${label}`} disabled={references.length >= 9 || references.some(reference => reference.path === output.media_path)} onClick={() => addReference({ path: output.media_path, title: label })} className="grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-hover-bg disabled:opacity-40"><Plus size={15}/></button>
        </div>;
      })}
      {hasMoreHistory && <button type="button" disabled={historyLoading} onClick={() => void loadHistory(historyOffset)} className="min-h-10 w-full rounded px-2 text-left text-primary hover:bg-hover-bg disabled:opacity-40">{t('moreHistory')}</button>}
      <h3 className="border-t border-glass-border px-2 pt-3 font-semibold text-text-muted">{t('copies')}</h3>
      {copies.map(copy => <div key={copy.id} className="flex min-w-0 items-center gap-1">
        <button type="button" onClick={() => useResult(copy.path, copy.title)} title={copy.title} className="min-h-10 min-w-0 flex-1 truncate rounded px-2 text-left hover:bg-hover-bg">{copy.title}</button>
        {sessionId && <button type="button" title={t('use')} aria-label={`${t('use')} ${copy.title}`} onClick={() => { const added = append(copy); toast.success(t(added ? 'added' : 'saved')); }} className="grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-hover-bg"><Plus size={15}/></button>}
        {eligiblePanoramaHandoff(copy) && <button type="button" title={t('openDirector')} aria-label={`${t('openDirector')} ${copy.title}`} onClick={() => { if (hasUnsavedEdit && !window.confirm(t('discard'))) return; if (!stagePanoramaHandoff(copy, window.sessionStorage)) return; onClose(); window.location.hash = '#/director'; }} className="grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-hover-bg"><Box size={15}/></button>}
      </div>)}
    </div>}
    toolPanel={referenceTools}
    canvasStatus={busy ? t('loading') : generation?.status === 'pending' || generation?.status === 'processing' ? t('generating') : undefined}
    onSave={saveFile}
    emptyState={<div className="grid h-full min-h-[280px] place-items-center p-6 text-center text-sm text-text-muted">{error || t('canvasEmpty')}</div>} />;
}

export default function PlaygroundImageEditor({ children }: { children: ReactNode }) {
  const t = useTranslations('imageEditor');
  const [editor, setEditor] = useState<{ reference?: string; title: string; sessionId: string | null } | null>(null);
  return <EditorContext.Provider value={(reference, title) => setEditor({ reference, title: title || t('title'), sessionId: usePlaygroundStore.getState().activeSessionId })}>
    {children}
    {editor && <EditorSession {...editor} onClose={() => setEditor(null)} />}
  </EditorContext.Provider>;
}

/** Standalone image editing workbench, independent of a generation session. */
export function StandaloneImageEditorPage() {
  const t = useTranslations('imageEditor');
  return <EditorSession title={t('title')} sessionId={null} onClose={() => { window.location.hash = '#/playground'; }} />;
}
