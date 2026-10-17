'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { agentRequest } from '@/lib/api';

type Memory = { id: string; content: string; source_quote: string };
type Candidate = { content: string; category: string; source_session_id: string; source_message_id: string; source_quote: string };

export default function MemorySettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('playground.sessions');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadErrorLabel = t('memoryLoadFailed');

  const refreshMemories = async () => {
    const result = await agentRequest<{ memories: Memory[] }>('/memories');
    setMemories(result.memories);
  };
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      agentRequest<{ enabled: boolean }>('/memory-settings'),
      agentRequest<{ memories: Memory[] }>('/memories'),
    ]).then(([settings, result]) => {
      if (!cancelled) { setEnabled(settings.enabled); setMemories(result.memories); }
    }).catch(() => { if (!cancelled) setError(loadErrorLabel); });
    return () => { cancelled = true; };
  }, [loadErrorLabel]);
  const toggle = async () => {
    if (enabled === null || busy) return;
    setBusy(true); setError('');
    try {
      const result = await agentRequest<{ enabled: boolean }>('/memory-settings', 'PATCH', { enabled: !enabled });
      setEnabled(result.enabled);
    } catch { setError(t('memorySaveFailed')); }
    finally { setBusy(false); }
  };
  const extract = async () => {
    setBusy(true); setError('');
    try {
      const result = await agentRequest<{ candidates: Candidate[] }>('/memories/extract', 'POST');
      setCandidates(result.candidates);
    } catch { setError(t('memoryActionFailed')); }
    finally { setBusy(false); }
  };
  const save = async (candidate: Candidate) => {
    setBusy(true); setError('');
    try {
      await agentRequest('/memories', 'POST', candidate);
      setCandidates(current => current.filter(item => item !== candidate));
      await refreshMemories();
    } catch { setError(t('memoryActionFailed')); }
    finally { setBusy(false); }
  };
  const edit = async (memory: Memory, content: string) => {
    if (!content.trim() || content === memory.content) return;
    setBusy(true); setError('');
    try { await agentRequest(`/memories/${memory.id}`, 'PATCH', { content: content.trim() }); await refreshMemories(); }
    catch { setError(t('memoryActionFailed')); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true); setError('');
    try { await agentRequest(`/memories/${id}`, 'DELETE'); await refreshMemories(); }
    catch { setError(t('memoryActionFailed')); }
    finally { setBusy(false); }
  };

  return <div role="dialog" aria-label={t('memorySettings')} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <section className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-glass-border bg-elevated p-4 shadow-xl" onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{t('memorySettings')}</h2>
        <button type="button" onClick={onClose} className="text-xs text-text-muted hover:text-foreground">{t('close')}</button>
      </div>
      <p className="mt-2 text-xs leading-5 text-text-muted">{t('memorySettingsDescription')}</p>
      {error && <p role="alert" className="mt-2 text-xs text-status-failed-fg">{error}</p>}
      <label className="mt-3 flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 hover:bg-hover-bg">
        <span className="text-xs text-foreground">{t('memoryEnable')}</span>
        <input type="checkbox" aria-label={t('memoryEnable')} checked={enabled ?? false} disabled={enabled === null || busy} onChange={() => { void toggle(); }} className="h-4 w-4 accent-primary" />
      </label>
      <div className="mt-4 border-t border-border-subtle pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium text-foreground">{t('confirmedMemories')}</h3>
          <button type="button" disabled={busy} onClick={() => { void extract(); }} className="min-h-9 rounded-lg border border-glass-border px-2 text-xs text-text-secondary hover:text-primary disabled:opacity-50">{t('extractMemoryCandidates')}</button>
        </div>
        {candidates.map(candidate => <div key={`${candidate.source_message_id}-${candidate.source_quote}`} className="mb-2 rounded-lg bg-surface-inset p-2 text-xs">
          <p>{candidate.content}</p><p className="mt-1 text-text-muted">{t('memorySource')}{candidate.source_quote}</p>
          <button type="button" disabled={busy} onClick={() => { void save(candidate); }} className="mt-2 min-h-8 rounded-md bg-primary/15 px-2 text-primary disabled:opacity-50">{t('confirmMemory')}</button>
        </div>)}
        {memories.map(memory => <div key={memory.id} className="mb-2 flex items-center gap-2 rounded-lg bg-surface-inset p-2 text-xs">
          <input aria-label={t('editMemory')} defaultValue={memory.content} key={`${memory.id}:${memory.content}`} onBlur={event => { void edit(memory, event.target.value); }} className="min-w-0 flex-1 bg-transparent text-foreground outline-none focus:ring-1 focus:ring-primary" />
          <button type="button" disabled={busy} onClick={() => { void remove(memory.id); }} className="min-h-8 px-2 text-text-muted hover:text-status-failed-fg disabled:opacity-50">{t('delete')}</button>
        </div>)}
      </div>
    </section>
  </div>;
}
