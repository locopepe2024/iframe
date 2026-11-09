'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { scriptEditorApi, type WritingEpisodeOutline, type WritingPlanDraft, type WritingWorkspace } from '@/lib/scriptEditorApi';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const fieldClass = 'mt-1 w-full rounded border border-white/15 bg-black/20 px-3 py-2 text-sm text-foreground';

export default function ScriptOutlineDialog({ open, workspace, onClose, onWorkspace, onNavigate }: {
  open: boolean;
  workspace: WritingWorkspace;
  onClose: () => void;
  onWorkspace: (workspace: WritingWorkspace) => void;
  onNavigate: (id: string) => Promise<void>;
}) {
  const t = useTranslations('scriptEditor.outlinePlan');
  const [draft, setDraft] = useState<WritingPlanDraft | null>(null);
  const [sourceHash, setSourceHash] = useState('');
  const [revision, setRevision] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activeEpisode, setActiveEpisode] = useState(0);
  const run = useRef(0);
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) modal.current?.showModal();
    else modal.current?.close();
  }, [open]);
  useEffect(() => () => { run.current += 1; }, []);

  useEffect(() => {
    if (!open) return;
    setDraft(workspace.plan ? structuredClone(workspace.plan) : null);
    setRevision(workspace.plan?.revision || null);
    setSourceHash(workspace.plan?.source_hash || workspace.source_hash);
    setEditing(false);
    setDirty(false);
    setError('');
    setActiveEpisode(0);
  }, [open]); // The dialog retains unsaved edits while its parent refreshes.

  const close = () => {
    if (busy && editing) return;
    if (dirty && !window.confirm(t('discard'))) return;
    run.current += 1;
    setBusy(false);
    onClose();
  };
  const detail = (cause: unknown) => {
    const value = (cause as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof value === 'string' ? value : value ? t('invalidPlan') : cause instanceof Error ? cause.message : t('failed');
  };
  const analyze = async () => {
    if (dirty && !window.confirm(t('discard'))) return;
    const currentRun = ++run.current;
    setBusy(true);
    setError('');
    try {
      let job = await scriptEditorApi.startOutlineAnalysis(workspace.root_document_id);
      for (let attempt = 0; job.status === 'running' || job.status === 'queued'; attempt += 1) {
        if (attempt >= 600) throw new Error(t('timeout'));
        await pause(1500);
        if (run.current !== currentRun) return;
        job = await scriptEditorApi.getOutlineAnalysisJob(workspace.root_document_id, job.id);
      }
      if (job.status !== 'completed' || !job.result) throw new Error(job.error || t('failed'));
      if (run.current !== currentRun) return;
      setDraft(job.result.draft);
      setSourceHash(job.result.source_hash);
      setEditing(true);
      setDirty(true);
      setActiveEpisode(0);
    } catch (cause) {
      if (run.current === currentRun) setError(detail(cause));
    } finally {
      if (run.current === currentRun) setBusy(false);
    }
  };
  const confirm = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const updated = await scriptEditorApi.confirmWritingPlan(workspace.root_document_id, { draft, base_revision: revision, source_hash: sourceHash });
      onWorkspace(updated);
      setDraft(updated.plan);
      setRevision(updated.plan?.revision || null);
      setDirty(false);
      setEditing(false);
    } catch (cause) { setError(detail(cause)); } finally { setBusy(false); }
  };
  const editField = (key: keyof WritingPlanDraft, value: string) => {
    setDraft(previous => previous && ({ ...previous, [key]: value }));
    setDirty(true);
  };
  const editEpisode = (key: keyof WritingEpisodeOutline, value: string | number) => {
    setDraft(previous => previous && ({ ...previous, episodes: previous.episodes.map((episode, index) => index === activeEpisode ? { ...episode, [key]: value } : episode) }));
    setDirty(true);
  };
  const episode = draft?.episodes[activeEpisode];
  return (
    <dialog ref={modal} onCancel={event => { event.preventDefault(); close(); }} className="m-auto w-[calc(100%-2rem)] max-w-5xl max-h-none overflow-hidden bg-transparent p-0 text-foreground backdrop:bg-black/70">
      <section role="dialog" aria-modal="true" aria-labelledby="outline-title" className="flex h-[90dvh] max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#101116] shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div><h2 id="outline-title" className="font-semibold">{t('title')}</h2><p className="mt-1 text-xs text-text-muted">{workspace.root_title}</p></div>
          <button type="button" aria-label={t('close')} onClick={close} className="rounded p-2 hover:bg-white/10"><X size={18} /></button>
        </header>
        <div className="playground-scrollbar min-h-0 flex-1 overflow-y-scroll overscroll-contain [scrollbar-gutter:stable]">
        <fieldset disabled={busy} className="min-w-0 p-5">
          {workspace.source_changed && <p className="mb-4 text-sm text-amber-300">{t('sourceChanged')}</p>}
          {error && <p role="alert" className="mb-4 text-sm text-red-300">{error}</p>}
          {!editing ? <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void analyze()} disabled={busy || !workspace.source_text.trim()} className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? t('analyzing') : t(workspace.plan ? 'reanalyze' : 'analyze')}</button>
              {workspace.plan && <button type="button" onClick={() => setEditing(true)} disabled={busy} className="rounded border border-white/15 px-4 py-2 text-sm">{t('edit')}</button>}
              {workspace.selected_episode_number && <button type="button" onClick={() => void onNavigate(workspace.root_document_id)} disabled={busy} className="rounded border border-white/15 px-4 py-2 text-sm">{t('backOutline')}</button>}
            </div>
            {!workspace.plan && <p className="text-sm text-text-secondary">{t('empty')}</p>}
            {workspace.plan && <div className="divide-y divide-white/10 border-y border-white/10">{workspace.plan.episodes.map(item => <div key={item.number} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm">{t('episode', { number: item.number })} · {item.title}</p><p className="mt-1 text-xs text-text-muted">{t('bodyCount', { count: item.word_count })}</p></div><button type="button" disabled={busy} onClick={() => void onNavigate(item.document_id)} className="shrink-0 rounded border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">{t('openEpisode')}</button></div>)}</div>}
          </div> : draft && <div className="space-y-5">
            <p className="text-sm text-text-secondary">{t('review')}</p>
            {(['background', 'style', 'point_of_view', 'characters', 'constraints'] as const).map(key => <label key={key} className="block text-sm text-text-secondary">{t(key)}<textarea className={fieldClass} rows={2} value={draft[key]} onChange={event => editField(key, event.target.value)} /></label>)}
            {draft.missing_information.length > 0 && <div className="text-sm text-amber-200"><strong>{t('missing')}</strong><ul className="mt-1 list-inside list-disc">{draft.missing_information.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
            {draft.suggestions.length > 0 && <div className="text-sm text-text-secondary"><strong>{t('suggestions')}</strong><ul className="mt-1 list-inside list-disc">{draft.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
            <div className="border-t border-white/10 pt-4"><label className="block text-sm text-text-secondary">{t('selectEpisode')}<select className={fieldClass} value={activeEpisode} onChange={event => setActiveEpisode(Number(event.target.value))}>{draft.episodes.map((item, index) => <option key={item.number} value={index}>{t('episode', { number: item.number })} · {item.title}</option>)}</select></label></div>
            {episode && <div className="space-y-3">{(['title', 'outline', 'opening_state', 'ending_state', 'characters', 'source_excerpt'] as const).map(key => <label key={key} className="block text-sm text-text-secondary">{t(key === 'characters' ? 'episodeCharacters' : key === 'title' ? 'episodeTitle' : key)}<textarea className={fieldClass} rows={key === 'outline' ? 5 : 2} value={episode[key] || ''} onChange={event => editEpisode(key, event.target.value)} /></label>)}<label className="block text-sm text-text-secondary">{t('target')}<input type="number" min={100} max={20000} step={1} className={fieldClass} value={episode.target_word_count || ''} onChange={event => editEpisode('target_word_count', Number(event.target.value))} /></label></div>}
          </div>}
        </fieldset>
        </div>
        {editing && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-4"><button type="button" disabled={busy} onClick={() => { if (!dirty || window.confirm(t('discard'))) { setDraft(workspace.plan); setEditing(false); setDirty(false); } }} className="rounded border border-white/15 px-4 py-2 text-sm">{t('cancel')}</button><button type="button" disabled={busy || !draft?.episodes.every(item => item.title.trim() && item.outline.trim() && Number.isInteger(item.target_word_count) && item.target_word_count >= 100 && item.target_word_count <= 20000)} onClick={() => void confirm()} className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{busy && <Loader2 size={16} className="animate-spin" />}{t('confirm')}</button></footer>}
      </section>
    </dialog>
  );
}
