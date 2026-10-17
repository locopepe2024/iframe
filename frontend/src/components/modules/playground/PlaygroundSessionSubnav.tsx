'use client';

import { MessageSquare, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { useState } from 'react';
import { agentRequest, playgroundApi } from '@/lib/api';
import FullNameHints from './FullNameHints';
import MemorySettingsDialog from './MemorySettingsDialog';
import OverflowActions from './OverflowActions';
import { shortReferenceLabel } from './referenceMedia';
import { createPlaygroundSession, openPlaygroundSession } from './playgroundSessionController';
import { usePlaygroundStore } from './usePlaygroundStore';

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default function PlaygroundSessionSubnav() {
  const t = useTranslations('playground.sessions');
  const sessions = usePlaygroundStore((state) => state.sessions);
  const activeSessionId = usePlaygroundStore((state) => state.activeSessionId);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [factSettingsOpen, setFactSettingsOpen] = useState(false);
  const [memorySettingsOpen, setMemorySettingsOpen] = useState(false);
  const [factCategories, setFactCategories] = useState<Array<{ id: string; display_name: string; auto_capture_enabled: boolean }>>([]);
  const [factSettingsError, setFactSettingsError] = useState('');

  const openFactSettings = async () => {
    setFactSettingsError('');
    setFactSettingsOpen(true);
    try {
      const result = await agentRequest<{ categories: typeof factCategories }>('/fact-categories');
      setFactCategories(result.categories);
    } catch { setFactSettingsError(t('factSettingsLoadFailed')); }
  };

  const toggleFactCategory = async (category: typeof factCategories[number]) => {
    const next = !category.auto_capture_enabled;
    setFactCategories(current => current.map(item => item.id === category.id ? { ...item, auto_capture_enabled: next } : item));
    try {
      const result = await agentRequest<{ category: typeof category }>(`/fact-categories/${encodeURIComponent(category.id)}`, 'PATCH', { auto_capture_enabled: next });
      setFactCategories(current => current.map(item => item.id === category.id ? { ...item, ...result.category } : item));
    } catch {
      setFactCategories(current => current.map(item => item.id === category.id ? { ...item, auto_capture_enabled: category.auto_capture_enabled } : item));
      setFactSettingsError(t('factSettingsSaveFailed'));
    }
  };
  const remove = async (id: string) => {
    setError('');
    try {
      await playgroundApi.deleteSession(id);
      const store = usePlaygroundStore.getState();
      const remaining = store.sessions.filter((session) => session.id !== id);
      store.setSessions(remaining);
      if (store.activeSessionId === id) {
        usePlaygroundStore.setState({ activeSessionId: null, parentGenerationId: null });
        store.setHistory([]);
        if (remaining.length) await openPlaygroundSession(remaining[0]);
        else await createPlaygroundSession();
      }
    } catch { setError(t('deleteFailed')); }
  };
  const rename = async () => {
    if (!renaming || !title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await playgroundApi.updateSession(renaming, { title: title.trim() });
      usePlaygroundStore.getState().updateSession({ ...updated, draft: { ...updated.draft, mode: updated.draft.mode as import('./usePlaygroundStore').PlaygroundMode } });
      setRenaming(null);
    } catch { setError(t('renameFailed')); }
    finally { setBusy(false); }
  };

  const handleCreate = async () => {
    try {
      await createPlaygroundSession();
    } catch (error) {
      console.error('[Playground] Failed to create session:', error);
    }
  };

  return (
    <FullNameHints className="ml-4 mt-1 border-l border-border-subtle pl-2" aria-label={t('navigationLabel')}>
      <button
        type="button"
        onClick={handleCreate}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <Plus size={15} aria-hidden="true" />
        <span>{t('new')}</span>
      </button>

      <div className="px-2.5 pb-1 pt-3 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-text-muted">
        {t('recent')}
      </div>

      {error && <p role="alert" className="px-2 text-xs text-status-failed-fg">{error}</p>}
      {renaming && <form className="space-y-2 p-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
        <input autoFocus aria-label={t('rename')} value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-glass-border bg-elevated p-2 text-xs" />
        <button disabled={busy || !title.trim()} className="mr-3 text-xs text-primary">{t('save')}</button>
        <button type="button" onClick={() => setRenaming(null)} className="text-xs text-text-muted">{t('cancel')}</button>
      </form>}
      <div className="mt-1 space-y-0.5">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          return (
            <div key={session.id} className="relative flex items-center">
            <button
              type="button"
              onClick={() => {
                void openPlaygroundSession(session).catch((error) => {
                  console.error('[Playground] Failed to load session:', error);
                });
              }}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'group flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                active
                  ? 'bg-primary/10 text-foreground'
                  : 'text-text-muted hover:bg-hover-bg hover:text-foreground',
              )}
            >
              <MessageSquare
                size={14}
                aria-hidden="true"
                className={clsx('shrink-0', active ? 'text-primary' : 'group-hover:text-foreground')}
              />
              <span className="min-w-0 flex-1">
                <span data-full-name={session.title} className="block truncate text-xs font-medium">{shortReferenceLabel(session.title)}</span>
                <span className="mt-0.5 block font-mono text-[0.5625rem] text-text-muted">
                  {formatUpdatedAt(session.updated_at)}
                </span>
              </span>
            </button>
            <OverflowActions label={t('manage')} actions={[
              { label: t('rename'), onClick: () => { setRenaming(session.id); setTitle(session.title); } },
              { label: t('factSettings'), onClick: () => { void openFactSettings(); } },
              { label: t('memorySettings'), onClick: () => setMemorySettingsOpen(true) },
              { label: t('delete'), danger: true, onClick: () => { void remove(session.id); } },
            ]} />
            </div>
          );
        })}
      </div>
      {factSettingsOpen && <div role="dialog" aria-label={t('factSettings')} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={() => setFactSettingsOpen(false)}>
        <section className="w-full max-w-sm rounded-xl border border-glass-border bg-elevated p-4 shadow-xl" onClick={event => event.stopPropagation()}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">{t('factSettings')}</h2>
            <button type="button" onClick={() => setFactSettingsOpen(false)} className="text-xs text-text-muted hover:text-foreground">{t('close')}</button>
          </div>
          <p className="mt-2 text-xs leading-5 text-text-muted">{t('factSettingsDescription')}</p>
          {factSettingsError && <p role="alert" className="mt-2 text-xs text-status-failed-fg">{factSettingsError}</p>}
          <div className="mt-3 space-y-1">
            {factCategories.map(category => <label key={category.id} className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2 hover:bg-hover-bg">
              <span className="text-xs text-foreground">{category.display_name}</span>
              <input type="checkbox" checked={category.auto_capture_enabled} onChange={() => { void toggleFactCategory(category); }} className="h-4 w-4 accent-primary" />
            </label>)}
          </div>
        </section>
      </div>}
      {memorySettingsOpen && <MemorySettingsDialog onClose={() => setMemorySettingsOpen(false)} />}
    </FullNameHints>
  );
}
