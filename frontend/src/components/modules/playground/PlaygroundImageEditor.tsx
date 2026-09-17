'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { ImagePlus } from 'lucide-react';
import { playgroundApi } from '@/lib/api';
import { imageEditorApi, type EditSource, type SavedImageEdit } from '@/lib/imageEditor';
import { usePlaygroundStore } from './usePlaygroundStore';
import { toast } from '@/store/toastStore';

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
  const [loaded, setLoaded] = useState<{ source: EditSource; url: string } | null>(null);
  const [copies, setCopies] = useState<SavedImageEdit[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const retry = useRef<{ hash: string; key: string }>();
  useEffect(() => { imageEditorApi.list().then(setCopies).catch(() => setError(t('historyFailed'))); }, [t]);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController(); let objectUrl: string | undefined;
    setError(''); setBusy(true);
    imageEditorApi.load(selected, abort.signal).then(({ source, blob }) => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setLoaded({ source, url: objectUrl });
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
  return <ImageEditor source={loaded?.url} title={name} onClose={onClose}
    onSave={async file => {
      if (!loaded) throw new Error('No source');
      const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('') + file.name;
      if (retry.current?.hash !== hash) retry.current = { hash, key: crypto.randomUUID() };
      const saved = await imageEditorApi.save(loaded.source, file, retry.current.key);
      append(saved); toast.success(t('saved')); onClose();
    }}
    emptyState={<div className="mx-auto flex max-w-2xl flex-col gap-4 p-5">
      <p className="text-text-secondary">{t('choose')}</p>
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-glass-border p-3">{t('upload')}
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className="min-w-0 text-sm" onChange={async event => {
          const file = event.target.files?.[0]; if (!file) return;
          if (file.size > 25 * 1024 * 1024) { setError(t('tooLarge')); return; }
          setBusy(true); setError('');
          try { const result = await playgroundApi.uploadMedia(file); if (!mounted.current) return; setName(file.name); setSelected(result.path); }
          catch { if (!mounted.current) return; setError(t('loadFailed')); setBusy(false); }
          event.target.value = '';
        }} />
      </label>
      {busy && <p role="status">{t('loading')}</p>}
      {error && <p role="alert" className="text-status-failed-fg">{error}</p>}
      <h3 className="font-semibold">{t('copies')}</h3>
      {copies.length === 0 && <p className="text-sm text-text-muted">{t('empty')}</p>}
      {copies.map(copy => <div key={copy.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-glass-border p-3">
        <span className="min-w-0 flex-1 break-words">{copy.title}</span>
        <button type="button" disabled={busy} className="min-h-11 rounded px-3 hover:bg-hover-bg" onClick={() => { setName(copy.title); setSelected(copy.path); }}>{t('edit')}</button>
        <button type="button" className="min-h-11 rounded px-3 hover:bg-hover-bg" onClick={() => { const added = append(copy); toast.success(t(added ? 'added' : 'saved')); onClose(); }}>{t('use')}</button>
      </div>)}
    </div>} />;
}

export default function PlaygroundImageEditor({ children }: { children: ReactNode }) {
  const t = useTranslations('imageEditor');
  const [editor, setEditor] = useState<{ reference?: string; title: string; sessionId: string | null } | null>(null);
  return <EditorContext.Provider value={(reference, title) => setEditor({ reference, title: title || t('title'), sessionId: usePlaygroundStore.getState().activeSessionId })}>
    {children}
    {editor && <EditorSession {...editor} onClose={() => setEditor(null)} />}
  </EditorContext.Provider>;
}
