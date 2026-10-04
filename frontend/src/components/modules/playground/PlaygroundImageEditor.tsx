'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { Box, ImagePlus, Plus } from 'lucide-react';
import type { PlaygroundGenerationResponse } from '@/lib/api';
import { imageEditorApi, type EditSource, type ImageProjectionType, type SavedImageEdit } from '@/lib/imageEditor';
import { getAssetUrl } from '@/lib/utils';
import { usePlaygroundStore } from './usePlaygroundStore';
import { toast } from '@/store/toastStore';
import ImageEditorReferenceTools, { type EditorReference, type GeneratedResultOptions } from './ImageEditorReferenceTools';

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
  const [projectionType, setProjectionType] = useState<ImageProjectionType>('perspective_plane');
  const [references, setReferences] = useState<EditorReference[]>(reference ? [{ path: reference, title }] : []);
  const [generation, setGeneration] = useState<PlaygroundGenerationResponse | null>(null);
  const generationRef = useRef<PlaygroundGenerationResponse | null>(null);
  const updateGeneration = useCallback((next: PlaygroundGenerationResponse | null) => { generationRef.current = next; setGeneration(next); }, []);
  const [comparisonPath, setComparisonPath] = useState<string | null>(null);
  const [panoramaCandidatePath, setPanoramaCandidatePath] = useState<string | null>(null);
  const [hasUnsavedEdit, setHasUnsavedEdit] = useState(false);
  const retry = useRef<{ hash: string; key: string }>();
  useEffect(() => { imageEditorApi.list().then(records => { copiesRef.current = records; setCopies(records); }).catch(() => setError(t('historyFailed'))); }, [t]);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController(); let objectUrl: string | undefined;
    setError(''); setBusy(true); setLoaded(null); setHasUnsavedEdit(false);
    imageEditorApi.load(selected, abort.signal).then(({ source, blob }) => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setLoaded({ source, url: objectUrl, blob });
      setProjectionType(source.width === 2 * source.height && copiesRef.current.find(copy => copy.path === selected)?.projection_type === 'equirectangular' ? 'equirectangular' : 'perspective_plane');
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
    if (path === selected) return;
    if (hasUnsavedEdit && !window.confirm(t('discard'))) return;
    setComparisonPath(generationRef.current?.outputs.some(output => output.media_path === path) ? selected ?? null : null);
    setPanoramaCandidatePath(options?.panoramaCandidate ? path : null);
    setName(resultTitle); setSelected(path);
  };
  const referenceTools = <ImageEditorReferenceTools references={references}
    onAdd={addReference} onRemove={path => setReferences(current => current.filter(item => item.path !== path))}
    onMove={moveReference} onUseResult={useResult} onGenerationChange={updateGeneration}/>;
  const saveFile = async (file: File, projection?: ImageProjectionType) => {
    if (!loaded) throw new Error('No source');
    const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('') + file.name + (projection ?? projectionType);
    if (retry.current?.hash !== hash) retry.current = { hash, key: crypto.randomUUID() };
    const selectedProjection = projection ?? projectionType;
    const saved = selectedProjection === 'perspective_plane'
      ? await imageEditorApi.save(loaded.source, file, retry.current.key)
      : await imageEditorApi.save(loaded.source, file, retry.current.key, selectedProjection);
    append(saved); copiesRef.current = [saved, ...copiesRef.current.filter(copy => copy.id !== saved.id)]; setCopies(copiesRef.current);
    toast.success(t('saved')); setComparisonPath(null); setPanoramaCandidatePath(null); setName(saved.title); setSelected(saved.path);
  };
  const isPanoramaCandidate = Boolean(loaded && selected === panoramaCandidatePath);
  const hasPanoramaRatio = Boolean(loaded && loaded.source.width === 2 * loaded.source.height);
  return <ImageEditor source={loaded?.url} comparisonSource={comparisonPath ? getAssetUrl(comparisonPath) : undefined} title={name} onClose={onClose} projectionType={projectionType} initialView={isPanoramaCandidate ? 'panorama' : 'preview'} panoramaCandidate={isPanoramaCandidate}
    onModified={() => setHasUnsavedEdit(true)}
    onDiscard={() => setHasUnsavedEdit(false)}
    panoramaEligible={hasPanoramaRatio || isPanoramaCandidate} panoramaSaveEligible={hasPanoramaRatio} onProjectionChange={setProjectionType}
    onSavePanoramaSource={loaded && !hasUnsavedEdit && hasPanoramaRatio ? async () => {
      const ext = loaded.source.mime === 'image/jpeg' ? 'jpg' : loaded.source.mime === 'image/webp' ? 'webp' : 'png';
      await saveFile(new File([loaded.blob], `${name.replace(/\.[^.]+$/, '') || 'panorama'}.${ext}`, { type: loaded.source.mime }), 'equirectangular');
    } : undefined}
    leftPanel={<div className="space-y-1 text-xs">
      {selected && <button type="button" disabled={references.length >= 9 || references.some(item => item.path === selected)} onClick={() => addReference({ path: selected, title: name })} className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover-bg disabled:opacity-40"><Plus size={15}/>{t('addCurrentReference')}</button>}
      <h3 className="px-2 pt-2 font-semibold text-text-muted">{t('copies')}</h3>
      {copies.map(copy => <div key={copy.id} className="flex min-w-0 items-center gap-1">
        <button type="button" onClick={() => useResult(copy.path, copy.title)} title={copy.title} className="min-h-10 min-w-0 flex-1 truncate rounded px-2 text-left hover:bg-hover-bg">{copy.title}</button>
        {sessionId && <button type="button" title={t('use')} aria-label={`${t('use')} ${copy.title}`} onClick={() => { const added = append(copy); toast.success(t(added ? 'added' : 'saved')); }} className="grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-hover-bg"><Plus size={15}/></button>}
        {copy.projection_type === 'equirectangular' && <button type="button" title={t('openDirector')} aria-label={`${t('openDirector')} ${copy.title}`} onClick={() => { onClose(); window.location.hash = '#/director'; }} className="grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-hover-bg"><Box size={15}/></button>}
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
