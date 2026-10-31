'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { RefreshCw, FileImage, Music, Film } from 'lucide-react';
import { materialLibrary, type TemporaryMaterial, type MaterialVersion } from '@/lib/materialLibrary';
import { API_URL } from '@/lib/api';
import { extractErrorDetail } from '@/lib/utils';
import PlaygroundImageEditor, { usePlaygroundImageEditor } from '../modules/playground/PlaygroundImageEditor';

export default function TemporaryMaterials() { return <PlaygroundImageEditor standalone><MaterialBrowser /></PlaygroundImageEditor>; }

function MaterialBrowser() {
  const zh = useLocale().startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const openEditor = usePlaygroundImageEditor();
  const [tab, setTab] = useState<'temporary' | 'saved'>('temporary');
  const [items, setItems] = useState<TemporaryMaterial[]>([]);
  const [saved, setSaved] = useState<MaterialVersion[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ url: string; kind: string; title: string } | null>(null);
  const load = async () => {
    setBusy(true); setError('');
    try {
      const [inventory, collection] = await Promise.all([materialLibrary.inventory(), materialLibrary.list()]);
      setItems(inventory.items); setCursor(inventory.next_offset); setSaved(collection);
      if (inventory.diagnostics.length) setError(t('部分历史记录无法读取，已暂停清理，请联系管理员。', 'Some history could not be read. Cleanup remains paused.'));
    } catch (err) { setError(extractErrorDetail(err)); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []); // mounted owner-scoped page
  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [preview]);
  const savedRefs = new Set(saved.map(item => item.reference));
  const rows = tab === 'saved' ? saved : items.filter(item => item.retention_state !== 'permanent' && !savedRefs.has(item.reference || ''));
  const filtered = rows.filter(item => item.title.toLowerCase().includes(query.toLowerCase()) && (kind === 'all' || item.media_type === kind));
  return <section className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-7" aria-label={t('素材留存', 'Material retention')}>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="glass-button min-h-11 px-3 aria-pressed:text-primary" aria-pressed={tab === 'temporary'} onClick={() => setTab('temporary')}>{t('临时素材', 'Temporary materials')}</button>
      <button type="button" className="glass-button min-h-11 px-3 aria-pressed:text-primary" aria-pressed={tab === 'saved'} onClick={() => setTab('saved')}>{t('已保存素材', 'Saved materials')}</button>
      <input className="glass-input min-h-11 w-48 px-3" aria-label={t('搜索当前已加载素材', 'Search loaded materials')} placeholder={t('搜索已加载素材…', 'Search loaded materials…')} value={query} onChange={event => setQuery(event.target.value)} />
      <select className="glass-input min-h-11 px-3" aria-label={t('素材类型', 'Material type')} value={kind} onChange={event => setKind(event.target.value)}><option value="all">{t('全部类型', 'All types')}</option><option value="image">{t('图片', 'Images')}</option><option value="video">{t('视频', 'Videos')}</option><option value="audio">{t('音频', 'Audio')}</option></select>
      <button type="button" className="glass-button flex min-h-11 items-center gap-2 px-3" disabled={busy} onClick={() => void load()}><RefreshCw size={16} />{t('刷新', 'Refresh')}</button>
    </div>
    <p className="text-sm text-text-secondary">{tab === 'temporary' ? t('模型结果、上传和编辑副本。保留目标为 7 天；当前处于历史引用核对期，自动删除尚未启用。保存到素材库后长期保留。', 'Model outputs, uploads and edit copies. Retention target: 7 days. Automatic deletion is paused during reference reconciliation. Save materials to keep them.') : t('每次保存保留独立文件；继续编辑会新增版本，旧版本保持可用。', 'Saved files are independent copies. Further edits add versions and preserve earlier versions.')}</p>
    {error && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}
    {notice && <p role="status" className="text-sm text-text-secondary">{notice}</p>}
    {busy && <p role="status">{t('处理中…', 'Working…')}</p>}
    {!busy && !filtered.length && <p className="text-sm text-text-muted">{t('暂无匹配素材。', 'No matching materials.')}</p>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{filtered.map(item => {
      const permanent = 'content_url' in item;
      const reference = permanent ? item.content_url : item.reference;
      const url = reference ? `${API_URL}${reference}` : '';
      const date = item.created_at ? new Date(item.created_at * 1000).toLocaleString() : t('时间待核对', 'Date pending review');
      return <article key={item.id} className="overflow-hidden rounded-xl border border-glass-border bg-surface">
        <button type="button" className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black/40 text-text-muted" disabled={!url} aria-label={`${t('预览', 'Preview')} ${item.title}`} onClick={() => setPreview({ url, kind: item.media_type, title: item.title })}>
          {url && item.media_type === 'image' ? <img className="h-full w-full object-contain" src={url} loading="lazy" alt={item.title} /> : item.media_type === 'video' ? <Film size={32} /> : item.media_type === 'audio' ? <Music size={32} /> : <FileImage size={32} />}
        </button>
        <div className="space-y-2 p-3"><p className="truncate font-medium" title={item.title}>{item.title}</p><p className="text-xs text-text-muted">{date}</p>
          <p className="text-xs text-text-secondary">{permanent ? `${t('长期保留', 'Kept')} · ${t('版本', 'Version')} ${item.id.slice(0, 8)}` : t('引用核对中，暂不自动删除', 'Under review; automatic deletion paused')}</p>
          {!permanent && item.proposed_expires_at && <p className="text-xs text-text-muted">{t('候选到期时间（未生效）：', 'Proposed expiry (inactive): ')}{new Date(item.proposed_expires_at * 1000).toLocaleString()}</p>}
          <div className="flex flex-wrap gap-2">{reference && item.media_type === 'image' && <button type="button" className="glass-button min-h-11 px-3 text-sm" disabled={busy} onClick={() => openEditor?.(reference, item.title)}>{permanent ? t('编辑新版本', 'Edit new version') : t('继续编辑', 'Continue editing')}</button>}
          {!permanent && reference && <button type="button" className="glass-button min-h-11 px-3 text-sm text-primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const result = await materialLibrary.save(reference, item.title); setSaved(old => [result, ...old.filter(row => row.id !== result.id)]); setNotice(t('已保存到素材库，长期保留。', 'Saved to material library.')); } catch (err) { setError(extractErrorDetail(err)); } finally { setBusy(false); } }}>{t('保存到素材库', 'Save to library')}</button>}</div>
        </div>
      </article>;
    })}</div>
    {tab === 'temporary' && cursor !== null && <button type="button" className="glass-button min-h-11 px-4" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const page = await materialLibrary.inventory(cursor); setItems(old => [...old, ...page.items]); setCursor(page.next_offset); } catch (err) { setError(extractErrorDetail(err)); } finally { setBusy(false); } }}>{t('加载更多', 'Load more')}</button>}
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={preview.title}>
      <div className="w-full max-w-4xl space-y-3 rounded-xl bg-surface p-4"><div className="flex items-center justify-between gap-3"><p className="truncate">{preview.title}</p><button type="button" autoFocus className="glass-button min-h-11 px-4" onClick={() => setPreview(null)}>{t('关闭', 'Close')}</button></div>
      {preview.kind === 'image' ? <img src={preview.url} alt={preview.title} className="max-h-[75dvh] w-full object-contain" /> : preview.kind === 'video' ? <video src={preview.url} controls className="max-h-[75dvh] w-full" /> : <audio src={preview.url} controls className="w-full" />}</div>
    </div>}
  </section>;
}
