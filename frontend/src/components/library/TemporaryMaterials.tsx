'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { RefreshCw, FileImage, Music, Film, Trash2, Undo2 } from 'lucide-react';
import { materialLibrary, type TemporaryMaterial, type MaterialVersion, type MaterialTrashEntry } from '@/lib/materialLibrary';
import { API_URL } from '@/lib/api';
import { extractErrorDetail } from '@/lib/utils';
import { materialDateKey, materialDateRange, materialMatchesDate } from './materialDates';
import PlaygroundImageEditor, { usePlaygroundImageEditor } from '../modules/playground/PlaygroundImageEditor';

type Material = TemporaryMaterial | MaterialVersion;
export default function TemporaryMaterials() { return <PlaygroundImageEditor standalone><MaterialBrowser /></PlaygroundImageEditor>; }

function VideoCover({ reference, title }: { reference: string; title: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [cover, setCover] = useState<{ reference: string; url: string } | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void materialLibrary.preview(reference, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setCover({ reference, url: objectUrl });
    }).catch(() => {});
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reference, visible]);

  const coverUrl = cover?.reference === reference ? cover.url : '';
  return <div ref={container} className="flex h-full w-full items-center justify-center bg-black/40 text-text-muted">
    {coverUrl ? <img className="h-full w-full object-contain" src={coverUrl} loading="lazy" alt={`${title} video cover`} /> : <Film size={32} aria-hidden="true" />}
  </div>;
}

function MaterialBrowser() {
  const zh = useLocale().startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const openEditor = usePlaygroundImageEditor();
  const [tab, setTab] = useState<'temporary' | 'saved' | 'trash'>('temporary');
  const [items, setItems] = useState<TemporaryMaterial[]>([]);
  const [saved, setSaved] = useState<MaterialVersion[]>([]);
  const [trash, setTrash] = useState<MaterialTrashEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [dateCounts, setDateCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const busy = loading || working;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ url: string; kind: string; title: string } | null>(null);
  const request = useRef(0);
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 250); return () => window.clearTimeout(timer); }, [query]);
  const filters = useMemo(() => ({ query: search, media_type: kind === 'all' ? undefined : kind,
    ...materialDateRange(month, day), timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
    temporary_only: true }), [search, kind, month, day]);
  useEffect(() => {
    const id = ++request.current;
    setLoading(true); setError(''); setItems([]); setCursor(null);
    void Promise.all([materialLibrary.inventory(0, filters), materialLibrary.list(), materialLibrary.trash()]).then(([inventory, collection, deleted]) => {
      if (id !== request.current) return;
      setItems(inventory.items); setCursor(inventory.next_offset); setTotal(inventory.total);
      setDateCounts(inventory.date_counts || {}); setSaved(collection); setTrash(deleted);
      if (inventory.diagnostics.length) setError(t('部分历史记录无法读取，已暂停清理，请联系管理员。', 'Some history could not be read. Cleanup remains paused.'));
    }).catch(err => { if (id === request.current) setError(extractErrorDetail(err)); })
      .finally(() => { if (id === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [filters, refresh]);
  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [preview]);
  const matches = (item: Material) => item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (kind === 'all' || item.media_type === kind);
  const localRows = tab === 'trash' ? trash.map(row => row.material) : saved;
  const rows: Material[] = tab === 'temporary' ? items : localRows.filter(item => matches(item) && materialMatchesDate(item.created_at, month, day));
  const counts = tab === 'temporary' ? dateCounts : localRows.filter(matches).reduce<Record<string, number>>((result, item) => {
    const key = materialDateKey(item.created_at); result[key] = (result[key] || 0) + 1; return result;
  }, {});
  const groups = new Map<string, Material[]>();
  for (const item of [...rows].sort((a, b) => (b.created_at ?? -Infinity) - (a.created_at ?? -Infinity))) {
    const key = materialDateKey(item.created_at);
    const group = groups.get(key);
    if (group) group.push(item); else groups.set(key, [item]);
  }
  const count = tab === 'temporary' ? total : rows.length;
  const monthDays = month ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() : 0;
  const operate = async (action: () => Promise<void>) => {
    if (busy) return;
    setWorking(true); setError(''); setNotice('');
    try { await action(); } catch (err) { setError(extractErrorDetail(err)); } finally { setWorking(false); }
  };
  const remove = (item: Material) => {
    if (!window.confirm(t(`将“${item.title}”移入回收站？可随时恢复，项目引用和已保存副本不受影响。此操作不释放磁盘空间。`, `Move “${item.title}” to the recycle bin? You can restore it. Project references and saved copies remain available. This does not free disk space.`))) return;
    void operate(async () => {
      const result = await materialLibrary.remove(tab === 'saved' ? 'saved' : 'temporary', item.id);
      setItems(old => old.filter(row => row.id !== item.id)); setSaved(old => old.filter(row => row.id !== item.id));
      setTrash(old => [result, ...old.filter(row => row.id !== result.id)]);
      setPreview(null); setNotice(t('已移入回收站，可在回收站恢复。', 'Moved to recycle bin. You can restore it there.')); setRefresh(value => value + 1);
    });
  };
  const loadMore = async () => {
    if (cursor === null || busy) return;
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const page = await materialLibrary.inventory(cursor, filters);
      if (id !== request.current) return;
      setItems(old => [...old, ...page.items.filter(item => !old.some(row => row.id === item.id))]);
      setCursor(page.next_offset); setTotal(page.total);
      if (page.diagnostics.length) setError(t('部分历史记录无法读取。', 'Some history could not be read.'));
    } catch (err) { if (id === request.current) setError(extractErrorDetail(err)); }
    finally { if (id === request.current) setLoading(false); }
  };
  return <section className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-7" aria-label={t('素材留存', 'Material retention')}>
    <div className="flex flex-wrap items-center gap-2">
      {(['temporary', 'saved', 'trash'] as const).map(value => <button key={value} type="button" className="glass-button min-h-11 px-3 aria-pressed:text-primary" aria-pressed={tab === value} onClick={() => setTab(value)}>{value === 'temporary' ? t('临时素材', 'Temporary materials') : value === 'saved' ? t('已保存素材', 'Saved materials') : t('回收站', 'Recycle bin')}</button>)}
      <button type="button" className="glass-button ml-auto flex min-h-11 items-center gap-2 px-3" disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />{t('刷新', 'Refresh')}</button>
    </div>
    <p className="text-sm text-text-secondary">{tab === 'temporary' ? t('模型结果、上传和编辑副本。保留目标为 7 天；历史引用核对期间暂停自动清理。保存后长期保留，删除后可在回收站恢复。', 'Model outputs, uploads and edit copies. Retention target: 7 days. Automatic deletion is paused during reference reconciliation. Save materials to keep them; deleted entries can be restored from the recycle bin.') : tab === 'saved' ? t('已保存的独立副本长期保留；继续编辑新增版本。删除移入回收站，项目引用不受影响。', 'Saved copies are kept independently; further edits add versions. Deletion moves entries to the recycle bin and preserves project references.') : t('可恢复已删除的素材。文件仍被保留，不会影响项目引用；当前不提供永久删除。', 'Restore deleted materials here. Files and project references are preserved; permanent deletion is unavailable.')}</p>
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('素材类型', 'Material type')}>
      {[['all', t('全部', 'All types')], ['image', t('图片', 'Images')], ['video', t('视频', 'Videos')], ['audio', t('音频', 'Audio')]].map(([value, label]) => <button key={value} type="button" className="glass-button flex min-h-11 items-center gap-2 px-3 text-sm aria-pressed:text-primary" aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'video' ? <Film size={16} aria-hidden="true" /> : value === 'audio' ? <Music size={16} aria-hidden="true" /> : value === 'image' ? <FileImage size={16} aria-hidden="true" /> : null}{label}</button>)}
      <input className="glass-input min-h-11 w-full min-w-0 px-3 sm:ml-auto sm:w-56" aria-label={t('搜索素材', 'Search materials')} placeholder={t('搜索全部素材…', 'Search all materials…')} maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <div className="space-y-2 rounded-lg border border-glass-border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-text-secondary">{t('按月查看', 'Review month')}<input type="month" className="glass-input mt-1 block min-h-11 max-w-full px-2 text-sm" value={month} onChange={event => { setMonth(event.target.value); setDay(''); }} /></label>
        <label className="text-xs text-text-secondary">{t('检索日期', 'Find date')}<input type="date" className="glass-input mt-1 block min-h-11 max-w-full px-2 text-sm" value={day} onChange={event => { setDay(event.target.value); setMonth(event.target.value.slice(0, 7)); }} /></label>
        <button type="button" className="glass-button min-h-11 px-3 text-sm aria-pressed:text-primary" aria-pressed={!month && !day} onClick={() => { setMonth(''); setDay(''); }}>{t('全部日期', 'All dates')}</button>
        <span className="pb-3 text-xs text-text-secondary">{t('按本地日期', 'Local dates')} · {count} {t('项', 'items')}</span>
      </div>
      {month && <div className="flex flex-wrap gap-1" role="group" aria-label={t('逐日查看', 'Review by day')}>
        <button type="button" className="glass-button min-h-11 px-3 text-sm aria-pressed:text-primary" aria-pressed={!day} onClick={() => setDay('')}>{t('整月', 'Whole month')}</button>
        {Array.from({ length: monthDays }, (_, index) => {
          const date = `${month}-${String(index + 1).padStart(2, '0')}`;
          return <button type="button" key={date} className="glass-button min-h-11 min-w-11 px-2 text-sm aria-pressed:text-primary" aria-label={`${date} · ${counts[date] || 0} ${t('项', 'items')}`} title={`${date} · ${counts[date] || 0} ${t('项', 'items')}`} aria-pressed={day === date} onClick={() => setDay(date)}>{index + 1}<span className="ml-1 text-xs text-text-muted">{counts[date] || 0}</span></button>;
        })}
      </div>}
    </div>
    {error && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}
    {notice && <p role="status" className="text-sm text-text-secondary">{notice}</p>}
    {busy && <p role="status">{t('处理中…', 'Working…')}</p>}
    {!busy && !rows.length && <p className="text-sm text-text-muted">{t('暂无匹配素材。', 'No matching materials.')}</p>}
    {Array.from(groups, ([dateKey, entries]) => <section key={dateKey} className="space-y-3" aria-label={dateKey === 'unknown' ? t('时间待核对', 'Date pending review') : dateKey}>
      <h2 className="text-sm font-medium">{dateKey === 'unknown' ? t('时间待核对', 'Date pending review') : dateKey}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{entries.map(item => {
        const permanent = 'content_url' in item;
        const reference = permanent ? item.content_url : item.reference;
        const url = reference ? `${API_URL}${reference}` : '';
        const deleted = tab === 'trash' ? trash.find(row => row.material.id === item.id && row.scope === (permanent ? 'saved' : 'temporary')) : undefined;
        return <article key={item.id} className="overflow-hidden rounded-xl border border-glass-border bg-surface" aria-label={item.title}>
          <button type="button" className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black/40 text-text-muted" disabled={!url || busy} aria-label={`${t('预览', 'Preview')} ${item.title}`} onClick={() => setPreview({ url, kind: item.media_type, title: item.title })}>
            {url && item.media_type === 'image' ? <img className="h-full w-full object-contain" src={url} loading="lazy" alt={item.title} /> : item.media_type === 'video' && reference ? <VideoCover reference={reference} title={item.title} /> : item.media_type === 'audio' ? <Music size={32} aria-hidden="true" /> : <FileImage size={32} aria-hidden="true" />}
          </button>
          <div className="space-y-2 p-3"><p className="truncate font-medium" title={item.title}>{item.title}</p><p className="text-xs text-text-muted">{materialDateKey(item.created_at) !== 'unknown' ? new Date(item.created_at! * 1000).toLocaleString() : t('时间待核对', 'Date pending review')}</p>
            {deleted ? <p className="text-xs text-text-secondary">{t('删除于', 'Deleted')} {new Date(deleted.deleted_at * 1000).toLocaleString()}</p> : <p className="text-xs text-text-secondary">{permanent ? `${t('长期保留', 'Kept')} · ${t('版本', 'Version')} ${item.id.slice(0, 8)}` : t('引用核对中，暂不自动删除', 'Under review; automatic deletion paused')}</p>}
            <div className="flex flex-wrap gap-2">
              {deleted ? <button type="button" className="glass-button flex min-h-11 items-center gap-2 px-3 text-sm" disabled={busy} aria-label={`${t('恢复', 'Restore')} ${item.title}`} onClick={() => void operate(async () => { await materialLibrary.restore(deleted.id); setTrash(old => old.filter(row => row.id !== deleted.id)); setNotice(t('素材已恢复。', 'Material restored.')); setRefresh(value => value + 1); })}><Undo2 size={16} aria-hidden="true" />{t('恢复', 'Restore')}</button> : <>
                {reference && item.media_type === 'image' && <button type="button" className="glass-button min-h-11 px-3 text-sm" disabled={busy} onClick={() => openEditor?.(reference, item.title)}>{permanent ? t('编辑新版本', 'Edit new version') : t('继续编辑', 'Continue editing')}</button>}
                {!permanent && reference && <button type="button" className="glass-button min-h-11 px-3 text-sm text-primary" disabled={busy} onClick={() => void operate(async () => { const result = await materialLibrary.save(reference, item.title); setSaved(old => [result, ...old.filter(row => row.id !== result.id)]); setItems(old => old.filter(row => row.id !== item.id)); setNotice(t('已保存到素材库，长期保留。', 'Saved to material library.')); setRefresh(value => value + 1); })}>{t('保存到素材库', 'Save to library')}</button>}
                <button type="button" className="glass-button flex min-h-11 items-center gap-2 px-3 text-sm text-status-failed-fg" disabled={busy} aria-label={`${t('删除', 'Delete')} ${item.title}`} onClick={() => remove(item)}><Trash2 size={16} aria-hidden="true" />{t('删除', 'Delete')}</button>
              </>}
            </div>
          </div>
        </article>;
      })}</div>
    </section>)}
    {tab === 'temporary' && cursor !== null && <button type="button" className="glass-button min-h-11 px-4" disabled={busy} onClick={() => void loadMore()}>{t('加载更多', 'Load more')}</button>}
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={preview.title}>
      <div className="w-full max-w-4xl space-y-3 rounded-xl bg-surface p-4"><div className="flex items-center justify-between gap-3"><p className="truncate">{preview.title}</p><button type="button" autoFocus className="glass-button min-h-11 px-4" onClick={() => setPreview(null)}>{t('关闭', 'Close')}</button></div>
      {preview.kind === 'image' ? <img src={preview.url} alt={preview.title} className="max-h-[75dvh] w-full object-contain" /> : preview.kind === 'video' ? <video src={preview.url} controls className="max-h-[75dvh] w-full" /> : <audio src={preview.url} controls className="w-full" />}</div>
    </div>}
  </section>;
}
