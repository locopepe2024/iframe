'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Images, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { api, playgroundApi, type AssetReferenceIndexEntry, type PlaygroundGenerationResponse, type UniArtCatalogModelResponse } from '@/lib/api';
import { imageEditorApi } from '@/lib/imageEditor';
import { getAssetUrl } from '@/lib/utils';
import ReferencePromptEditor, { type ReferenceSuggestion } from './ReferencePromptEditor';
import { renderMarkedImage, type Marking } from '@/components/shared/image-editor/ImageMarkingCanvas';

export interface EditorReference { path: string; title: string }
type GenerationMode = 'reference' | 'panorama';
export type GeneratedResultOptions = { panoramaCandidate: true };
export const PANORAMA_PROMPT_PREFIX = 'Create a production-ready 360-degree equirectangular panorama in exact 2:1 format. Fill the complete sphere: continuous sky through the zenith, continuous ground through the nadir, no black/transparent holes, no empty bands, no missing ceiling or floor, level horizon, and seamless left/right edge continuity. Keep architectural lines and lighting consistent across the wrap. ';

export function generationInputMedia(references: EditorReference[]): string[] {
  return references.map(reference => reference.path);
}

export default function ImageEditorReferenceTools({ references, onAdd, onRemove, onMove, onUseResult, onGenerationChange, mask, maskSource }: {
  references: EditorReference[];
  onAdd: (reference: EditorReference) => void;
  onRemove: (path: string) => void;
  onMove: (path: string, direction: -1 | 1) => void;
  onUseResult: (path: string, title: string, options?: GeneratedResultOptions) => void;
  onGenerationChange?: (generation: PlaygroundGenerationResponse | null) => void;
  mask?: Marking;
  maskSource?: { path: string; url: string; width: number; height: number } | null;
}) {
  const t = useTranslations('imageEditor');
  const [library, setLibrary] = useState<AssetReferenceIndexEntry[] | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState<UniArtCatalogModelResponse[]>([]);
  const [modelId, setModelId] = useState('');
  const [mode, setMode] = useState<GenerationMode>('reference');
  const [submittedMode, setSubmittedMode] = useState<GenerationMode>('reference');
  const [prompt, setPrompt] = useState('');
  const [generation, setGeneration] = useState<PlaygroundGenerationResponse | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [mention, setMention] = useState<ReferenceSuggestion | null>(null);
  const handledOutput = useRef('');
  const showGenerated = (path: string) => {
    if (submittedMode === 'panorama') onUseResult(path, t('generatedImage'), { panoramaCandidate: true });
    else onUseResult(path, t('generatedImage'));
  };
  useEffect(() => {
    let active = true;
    playgroundApi.getUniArtModels().then(catalog => {
      if (!active) return;
      setModels(catalog.models.filter(model => model.capabilities.some(capability => capability === 'i2i' || capability === 't2i')));
    }).catch(() => { if (active) setError(t('modelsFailed')); });
    return () => { active = false; };
  }, [t]);
  useEffect(() => {
    if (!generation || pollFailed || ['completed', 'failed'].includes(generation.status)) return;
    let active = true;
    const timer = window.setInterval(() => {
      playgroundApi.getGenerationStatus(generation.id).then(result => { if (active) { setGeneration(result); onGenerationChange?.(result); } })
        .catch(() => { if (active) { setPollFailed(true); setError(t('generationStatusFailed')); } });
    }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [generation?.id, generation?.status, pollFailed, t, onGenerationChange]);
  useEffect(() => {
    const output = generation?.status === 'completed' ? generation.outputs.find(item => item.media_type === 'image') : null;
    if (!generation || !output || handledOutput.current === generation.id) return;
    handledOutput.current = generation.id;
    showGenerated(output.media_path);
  }, [generation, onUseResult, submittedMode, t]);
  const inputMedia = generationInputMedia(references);
  const hasMask = Boolean(maskSource && mask && (mask.strokes.length || mask.rect));
  const taskMode = inputMedia.length || hasMask ? 'i2i' : 't2i';
  const availableModels = useMemo(() => models.filter(model => model.capabilities.includes(taskMode)), [models, taskMode]);
  useEffect(() => setModelId(current => current && availableModels.some(model => model.id === current) ? current : availableModels[0]?.id ?? ''), [availableModels]);
  const selectedModel = availableModels.find(model => model.id === modelId);
  const referenceLimit = Math.min(9, Math.max(0, selectedModel?.inputs?.reference_images?.max ?? 9));
  const filteredLibrary = useMemo(() => (library ?? []).filter(entry => entry.variants.length > 0 && `${entry.name} ${entry.source_name ?? ''}`.toLowerCase().includes(librarySearch.toLowerCase())), [library, librarySearch]);
  const entryKey = (entry: AssetReferenceIndexEntry) => `${entry.source_scope}:${entry.source_container_id ?? ''}:${entry.asset_type}:${entry.asset_id}`;
  const addUploads = async (files: FileList | null) => {
    if (!files?.length) return;
    if (references.length + files.length > 9) { setError(t('referenceLimit')); return; }
    setBusy(true); setError('');
    try {
      for (const file of Array.from(files)) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 25 * 1024 * 1024) throw new Error(t('referenceInvalid'));
        const uploaded = await playgroundApi.uploadMedia(file);
        onAdd({ path: uploaded.path, title: file.name });
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : t('loadFailed')); }
    finally { setBusy(false); }
  };
  const openLibrary = async () => {
    setLibraryOpen(current => !current);
    if (library) return;
    setBusy(true); setError('');
    try { setLibrary((await api.getAssetLibraryIndex()).assets); }
    catch { setError(t('libraryFailed')); }
    finally { setBusy(false); }
  };
  const importEntry = async (entry: AssetReferenceIndexEntry) => {
    if (references.length >= 9) { setError(t('referenceLimit')); return; }
    setBusy(true); setError('');
    try {
      const variantId = selectedVariants[entryKey(entry)] || entry.selected_variant_id || entry.variants[0].id;
      const imported = await imageEditorApi.importLibraryVariant(entry, variantId);
      onAdd({ path: imported.path, title: imported.title });
    } catch { setError(t('libraryImportFailed')); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    if (!selectedModel || !prompt.trim() || busy || generation?.status === 'processing' || generation?.status === 'pending') return;
    const generationInputs = hasMask && maskSource ? [maskSource.path, ...inputMedia.filter(path => path !== maskSource.path)] : inputMedia;
    if (generationInputs.length > referenceLimit) { setError(t('modelReferenceLimit')); return; }
    if (hasMask && !modelId.startsWith('uniart/')) { setError(t('maskRequiresUniart')); return; }
    setBusy(true); setError(''); setGeneration(null); onGenerationChange?.(null); setPollFailed(false); setSubmittedMode(mode);
    const instruction = mode === 'panorama'
      ? `${PANORAMA_PROMPT_PREFIX}${prompt.trim()}`
      : prompt.trim();
    try {
      let maskPath: string | undefined;
      if (hasMask && maskSource && mask) {
        const blob = await renderMarkedImage(maskSource.url, mask, maskSource.width, maskSource.height, true);
        maskPath = (await playgroundApi.uploadMedia(new File([blob], 'edit-mask.png', { type: 'image/png' }))).path;
      }
      const result = await playgroundApi.generate({ mode: taskMode, model_id: modelId, prompt: instruction,
        input_media: generationInputs.length ? generationInputs : undefined,
        media_names: Object.fromEntries(references.map(reference => [reference.path, reference.title])),
        parameters: { ...(mode === 'panorama' ? { size: '4k', aspect_ratio: '2:1' } : {}), ...(maskPath ? { mask: maskPath } : {}) },
        batch_size: 1 });
      setGeneration(result); onGenerationChange?.(result);
    } catch { setError(t('generationFailed')); }
    finally { setBusy(false); }
  };
  return <div className="flex flex-col gap-4 text-sm">
    <section className="space-y-2" aria-label={t('references')}>
      <div className="flex items-center justify-between"><h3 className="font-semibold">{t('references')} <span className="font-normal text-text-muted">{references.length}/9</span></h3></div>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded border border-glass-border px-2 hover:bg-hover-bg"><Plus size={15}/>{t('uploadReferences')}<input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy || references.length >= 9} className="sr-only" onChange={event => { void addUploads(event.target.files); event.target.value = ''; }}/></label>
        <button type="button" disabled={busy || references.length >= 9} onClick={() => void openLibrary()} className="inline-flex min-h-9 items-center gap-1 rounded border border-glass-border px-2 hover:bg-hover-bg"><Images size={15}/>{t('libraryReferences')}</button>
      </div>
      {libraryOpen && <div className="space-y-2 border-2 border-primary/60 bg-elevated p-2">
        <h4 className="text-xs font-semibold">{t('libraryReferences')}</h4>
        <input aria-label={t('searchLibrary')} value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder={t('searchLibrary')} className="min-h-9 w-full rounded border border-glass-border bg-surface px-2"/>
        <div className="max-h-48 space-y-2 overflow-auto">
          {filteredLibrary.map(entry => <div key={entryKey(entry)} className="flex min-w-0 items-center gap-2 border-b border-glass-border pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={getAssetUrl(entry.variants.find(variant => variant.id === (selectedVariants[entryKey(entry)] || entry.selected_variant_id))?.url || entry.variants[0].url)} alt="" className="h-10 w-10 shrink-0 object-cover"/>
            <div className="min-w-0 flex-1"><strong className="block truncate text-xs">{entry.name}</strong><small className="text-text-muted">{entry.source_name || entry.source_scope}</small>
              {entry.variants.length > 1 && <select aria-label={`${entry.name} ${t('variant')}`} value={selectedVariants[entryKey(entry)] || entry.selected_variant_id || entry.variants[0].id} onChange={event => setSelectedVariants(current => ({ ...current, [entryKey(entry)]: event.target.value }))} className="mt-1 w-full bg-surface text-xs">{entry.variants.map((variant, index) => <option key={variant.id} value={variant.id}>{t('variant')} {index + 1}</option>)}</select>}
            </div>
            <button type="button" disabled={busy || references.length >= 9} title={`${t('addReference')} ${entry.name}`} aria-label={`${t('addReference')} ${entry.name}`} onClick={() => void importEntry(entry)} className="grid h-9 w-9 shrink-0 place-items-center rounded border border-glass-border"><Plus size={16}/></button>
          </div>)}
          {library && filteredLibrary.length === 0 && <p className="text-text-muted">{t('libraryEmpty')}</p>}
        </div>
      </div>}
      <div className="border-t-2 border-glass-border pt-3"><h4 className="mb-2 text-xs font-semibold">{t('addedReferences')} ({references.length})</h4>
      <ol className="space-y-1">{references.map((reference, index) => <li key={reference.path} className="flex min-w-0 items-center gap-1 border-b border-glass-border py-1">
        <button type="button" title={t('canvasPreview')} aria-label={`${t('canvasPreview')} ${reference.title}`} onClick={() => onUseResult(reference.path, reference.title)} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getAssetUrl(reference.path)} alt="" className="h-9 w-9 shrink-0 object-cover"/>
          <span className="min-w-0 truncate text-xs">{index + 1}. {reference.title}</span>
        </button>
        <button type="button" disabled={index === 0} title={t('moveUp')} aria-label={`${t('moveUp')} ${reference.title}`} onClick={() => onMove(reference.path, -1)}><ArrowUp size={15}/></button>
        <button type="button" disabled={index === references.length - 1} title={t('moveDown')} aria-label={`${t('moveDown')} ${reference.title}`} onClick={() => onMove(reference.path, 1)}><ArrowDown size={15}/></button>
        <button type="button" title={t('removeReference')} aria-label={`${t('removeReference')} ${reference.title}`} onClick={() => onRemove(reference.path)}><Trash2 size={15}/></button>
      </li>)}</ol></div>
    </section>
    <section className="space-y-2 border-t border-glass-border pt-3" aria-label={t('generateImage')}>
      <h3 className="font-semibold">{t('generateImage')}</h3>
      <div className="flex rounded border border-glass-border" role="group" aria-label={t('generationMode')}>
        <button type="button" aria-pressed={mode === 'reference'} onClick={() => setMode('reference')} className={`min-h-9 flex-1 ${mode === 'reference' ? 'bg-primary text-primary-foreground' : ''}`}>{t('referenceGeneration')}</button>
        <button type="button" aria-pressed={mode === 'panorama'} onClick={() => setMode('panorama')} className={`min-h-9 flex-1 ${mode === 'panorama' ? 'bg-primary text-primary-foreground' : ''}`}>{t('panoramaGeneration')}</button>
      </div>
      <label className="block">{t('model')}<select value={modelId} onChange={event => setModelId(event.target.value)} className="mt-1 min-h-9 w-full rounded border border-glass-border bg-surface px-2">{availableModels.map(model => <option key={model.id} value={model.id}>{model.display_name}</option>)}</select></label>
      {availableModels.length === 0 && <p role="status" className="text-xs text-text-muted">{t('noImageModel')}</p>}
      {references.length + (hasMask && maskSource && !references.some(reference => reference.path === maskSource.path) ? 1 : 0) > referenceLimit && <p role="status" className="text-xs text-status-failed-fg">{t('modelReferenceLimit')}</p>}
      {hasMask && <p role="status" className="text-xs text-text-muted">{t('maskActive')}</p>}
      <div className="relative"><label className="mb-1 block" id="image-editor-prompt-label">{t('prompt')}</label>
        <div className="rounded border border-glass-border bg-surface p-2" aria-labelledby="image-editor-prompt-label">
          <ReferencePromptEditor value={prompt} labels={references.map(reference => reference.title)} placeholder={t('prompt')} onChange={setPrompt} onMentionChange={setMention}/>
        </div>
        {mention && <div role="listbox" aria-label={t('selectReference')} className="absolute bottom-full z-20 mb-1 max-h-48 w-full overflow-auto rounded border border-glass-border bg-elevated p-1 shadow-lg">
          {references.filter(reference => reference.title.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase())).map(reference =>
            <button key={reference.path} type="button" role="option" onMouseDown={event => event.preventDefault()} onClick={() => { mention.choose(reference.title); setMention(null); }} className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover-bg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={getAssetUrl(reference.path)} alt="" className="h-8 w-8 shrink-0 object-cover"/><span className="min-w-0 truncate">@{reference.title}</span>
            </button>)}
          {references.length === 0 && <p className="p-2 text-text-muted">{t('addReferenceFirst')}</p>}
        </div>}
      </div>
      <button type="button" disabled={!modelId || !prompt.trim() || busy || (generation && ['pending', 'processing'].includes(generation.status)) || inputMedia.length + (hasMask && maskSource && !inputMedia.includes(maskSource.path) ? 1 : 0) > referenceLimit} onClick={() => void generate()} className="min-h-10 w-full rounded bg-primary px-3 font-medium text-primary-foreground disabled:opacity-50">{mode === 'panorama' ? t('generatePanoramaCandidate') : t('generateImage')}</button>
      {mode === 'panorama' && <p className="text-xs text-text-muted">{t('panoramaCandidateNote')}</p>}
      {generation && <div role="status" className="space-y-2 border-t border-glass-border pt-2"><strong>{generation.status === 'completed' ? t('generationReady') : generation.status === 'failed' ? t('generationFailed') : t('generating')}</strong>
        {pollFailed && <button type="button" className="min-h-9 rounded border border-glass-border px-2" onClick={() => { setError(''); setPollFailed(false); }}>{t('retryStatus')}</button>}
        {generation.error && <p role="alert">{generation.error}</p>}
        {generation.status === 'completed' && !generation.outputs.some(output => output.media_type === 'image') && <p role="alert" className="text-status-failed-fg">{t('noGeneratedImage')}</p>}
        {generation.status === 'completed' && generation.outputs.filter(output => output.media_type === 'image').map(output => <button key={output.id} type="button" onClick={() => showGenerated(output.media_path)} className="min-h-9 w-full rounded border border-glass-border px-2 text-left hover:bg-hover-bg">{submittedMode === 'panorama' ? t('browsePanorama') : t('showGenerated')}</button>)}
      </div>}
      {error && <p role="alert" className="text-status-failed-fg">{error}</p>}
    </section>
  </div>;
}
