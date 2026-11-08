'use client';

import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FileUp, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ImportFileDialog from '@/components/series/ImportFileDialog';
import { scriptEditorApi } from '@/lib/scriptEditorApi';
import ScriptDocumentActions from './ScriptDocumentActions';

type ScriptDocumentItem = { id: string; title: string; updated_at: string };

export default function ScriptDocumentLibrary() {
  const t = useTranslations('scriptEditor.document');
  const [documents, setDocuments] = useState<ScriptDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDocuments(await scriptEditorApi.listScriptDocuments());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('listFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createDocument = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const document = await scriptEditorApi.createScriptDocument(t('untitled'));
      window.location.hash = `#/studio/editor/${document.id}`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('newFailed'));
    } finally {
      setCreating(false);
    }
  };

  const deleteDocument = async (document: ScriptDocumentItem) => {
    if (deletingId || !window.confirm(t('confirmDelete', { title: document.title }))) return;
    setDeletingId(document.id);
    setError('');
    try {
      await scriptEditorApi.deleteScriptDocument(document.id);
      setDocuments(current => current.filter(item => item.id !== document.id));
    } catch (cause) {
      const detail = (cause as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('deleteFailed'));
    } finally { setDeletingId(null); }
  };

  return (
    <main className="flex h-full min-h-0 flex-col bg-[#050508] text-foreground">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-3">
        <h1 className="text-base font-semibold">{t('library')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading || Boolean(deletingId)} className="grid size-11 place-items-center rounded border border-white/15 text-zinc-300 hover:bg-white/10 disabled:opacity-50" aria-label={t('refresh')}>
            <RefreshCw size={16} />
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className="flex h-11 items-center gap-2 rounded border border-white/15 px-3 text-sm text-zinc-200 hover:bg-white/10">
            <FileUp size={16} /> {t('import')}
          </button>
          <button type="button" onClick={() => void createDocument()} disabled={creating} className="flex h-11 items-center gap-2 rounded bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">
            <FilePlus2 size={16} /> {t(creating ? 'creating' : 'new')}
          </button>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
        {loading ? <p role="status" className="py-8 text-sm text-text-muted">{t('loading')}</p> : documents.length === 0 ? (
          <p className="py-8 text-sm text-text-muted">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-white/10 border-y border-white/10">
            {documents.map((document) => (
              <li key={document.id} className="flex items-center gap-2">
                <button type="button" onClick={() => { window.location.hash = `#/studio/editor/${document.id}`; }} disabled={deletingId === document.id} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4 disabled:opacity-50 text-left hover:bg-white/[0.03]">
                  <span className="min-w-0 truncate text-sm font-medium">{document.title}</span>
                  <time className="shrink-0 text-xs text-zinc-500">{new Date(document.updated_at).toLocaleString()}</time>
                </button>
                <ScriptDocumentActions title={document.title} disabled={Boolean(deletingId)} deleting={deletingId === document.id}
                  onOpen={() => { window.location.hash = `#/studio/editor/${document.id}`; }}
                  onDelete={() => { void deleteDocument(document); }} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <ImportFileDialog isOpen={importOpen} onClose={() => { setImportOpen(false); void refresh(); }} />
    </main>
  );
}
