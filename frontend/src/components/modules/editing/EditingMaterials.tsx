'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { editing, type EditFolder, type EditMaterial } from '@/lib/editing';
import { extractErrorDetail, getVideoPosterUrl } from '@/lib/utils';
import { ChevronRight, Folder, FolderInput, Lock, Music, Plus, Search, Trash2, Upload } from 'lucide-react';

type Props = { onSelect?: (item: EditMaterial) => void; disabled?: boolean };
export function EditingMaterials({ onSelect, onImport, materials = {}, disabled = false }: Props & { onImport: () => void; materials?: Record<string, EditMaterial> }) {
  const zh = useLocale().startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const items = Object.values(materials);
  return <section className="min-w-0 space-y-3" aria-label={t('剪辑素材库', 'Editing materials')}>
    <button type="button" className="glass-button min-h-11 px-3 py-2" disabled={disabled} onClick={onImport}>{t('导入', 'Import')}</button>
    {!items.length && <p className="text-xs text-text-secondary">{t('导入视频或音频开始剪辑。', 'Import video or audio to start editing.')}</p>}
    <div className="grid grid-cols-2 gap-2">{items.map(item => <article key={item.id} className="group relative min-w-0 overflow-hidden rounded-lg border border-glass-border bg-surface" title={`${item.name} · ${(item.duration_ms / 1000).toFixed(3)}s`}>
      <div className="aspect-video overflow-hidden bg-black/40">
        {item.video ? <video className="h-full w-full object-cover" src={item.url} poster={getVideoPosterUrl(item.url) || undefined} muted preload="metadata" aria-label={item.name} /> : <div className="flex h-full items-center justify-center text-text-muted"><Music size={24} aria-hidden="true" /></div>}
      </div>
      <div className="flex items-center gap-1 p-1"><span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
        <button type="button" className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-primary text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40" aria-label={`${t('添加素材', 'Add material')} ${item.name}`} title={t('添加到时间线', 'Add to timeline')} disabled={disabled} onClick={() => onSelect?.(item)}><Plus size={18} aria-hidden="true" /></button>
      </div>
    </article>)}</div>
  </section>;
}
export function EditingMaterialManager(props: Props) { return <MaterialBrowser {...props} manage />; }

function MaterialBrowser({ onSelect, disabled = false, manage }: Props & { manage: boolean }) {
  const zh = useLocale().startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState<EditFolder[]>([]);
  const [items, setItems] = useState<EditMaterial[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState('');
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [reload, setReload] = useState(0);
  const [folderForm, setFolderForm] = useState<'create' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const busy = loading || mutating;
  const selectedFolder = folders.find(folder => folder.id === folderId);
  const childFolders = folders.filter(folder => (folder.parent_id || '') === folderId);
  const ancestors = (() => { const result: EditFolder[] = []; let current = selectedFolder; while (current) { result.unshift(current); current = folders.find(folder => folder.id === current?.parent_id); } return result; })();
  const message = (err: unknown) => {
    const detail = extractErrorDetail(err);
    if (!zh) return detail;
    const translated: Record<string, string> = {
      'Folder is not empty': '目录内还有素材，请先移动或删除素材。',
      'Folder name already exists': '已存在同名目录。',
      'Folder not found': '目录不存在，请刷新后重试。',
      'Material is referenced by a saved editing project or version': '素材被剪辑项目或历史版本引用，暂时不能删除。',
    };
    return translated[detail] || detail;
  };
  useEffect(() => {
    let active = true;
    void editing.folders().then(value => { if (active) setFolders(value); }).catch(err => { if (active) setError(extractErrorDetail(err)); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    let active = true;
    setLoading(true); setItems([]); setCursor(null);
    void editing.materials(query, 0, folderId || '__root').then(page => {
      if (active) { setItems(page.items); setCursor(page.next_cursor); setError(''); }
    }).catch(err => { if (active) setError(extractErrorDetail(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, folderId, reload]);
  const run = async (action: () => Promise<void>) => {
    setMutating(true); setError('');
    try { await action(); } catch (err) { setError(message(err)); } finally { setMutating(false); }
  };
  return <section className="min-w-0 space-y-3 rounded-xl border border-glass-border p-3" aria-label={manage ? t('素材管理', 'Material management') : t('剪辑素材库', 'Editing materials')}>
    <div className="flex flex-wrap items-center gap-2">
      {manage && <h2 className="mr-auto font-semibold">{t('素材管理', 'Material management')}</h2>}
      {manage && <>
        <button type="button" className="glass-button min-h-11 px-3 py-2" disabled={busy} onClick={() => { setFolderForm('create'); setName(''); }}>{t('新建目录', 'New folder')}</button>
        <button type="button" className="glass-button min-h-11 px-3 py-2" disabled={busy || !selectedFolder} onClick={() => { setFolderForm('rename'); setName(selectedFolder!.name); }}>{t('重命名目录', 'Rename folder')}</button>
        <button type="button" className="glass-button min-h-11 px-3 py-2" disabled={busy || !selectedFolder} onClick={() => { if (window.confirm(t('确认删除这个空目录？', 'Delete this empty folder?'))) void run(async () => { await editing.deleteFolder(folderId); setFolderId(''); setReload(n => n + 1); }); }}>{t('删除目录', 'Delete folder')}</button>
      </>}
    </div>
    {folderForm && <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void run(async () => {
      if (folderForm === 'create') await editing.createFolder(name.trim(), folderId || null);
      else await editing.renameFolder(folderId, name.trim());
      setFolderForm(null); setName(''); setReload(n => n + 1);
    }); }}>
      <label className="text-sm">{t('目录名称', 'Folder name')} <input autoFocus className="glass-input px-3 py-2" maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
      <button type="submit" className="glass-button min-h-11 px-3 py-2" disabled={busy || !name.trim()}>{t('保存目录', 'Save folder')}</button>
      <button type="button" className="glass-button min-h-11 px-3 py-2" disabled={busy} onClick={() => setFolderForm(null)}>{t('取消', 'Cancel')}</button>
    </form>}
    <div className="flex flex-wrap items-center gap-2">
      <nav className="flex min-w-0 items-center gap-1 text-sm" aria-label={t('目录路径', 'Folder path')}>
        <button type="button" className="glass-button px-2 py-1" disabled={mutating} onClick={() => setFolderId('')}>{t('根目录', 'Root')}</button>
        {ancestors.map(folder => <span key={folder.id} className="inline-flex items-center gap-1"><ChevronRight size={14} className="text-text-muted" /><button type="button" className="glass-button max-w-40 truncate px-2 py-1" disabled={mutating} onClick={() => setFolderId(folder.id)}>{folder.name}</button></span>)}
      </nav>
      <label className="relative w-full sm:w-52"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-text-muted" /><input aria-label={t('搜索素材', 'Search materials')} className="glass-input w-full py-2 pl-9 pr-3" placeholder={t('搜索素材…', 'Search materials…')} disabled={mutating} value={query} onChange={event => setQuery(event.target.value)} /></label>
      {manage && <label className="glass-button flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2"><Upload size={15} />{t('上传视频或音频', 'Upload video or audio')}<input className="sr-only" type="file" multiple accept="video/*,audio/*" disabled={busy} onChange={async event => {
        const files = Array.from(event.target.files || []); event.target.value = ''; if (!files.length) return;
        setMutating(true); setError(''); setUploadErrors([]); const failures: string[] = []; let uploaded = 0;
        try {
          for (let index = 0; index < files.length; index += 1) {
            setProgress(`${t('正在上传', 'Uploading')} ${index + 1} / ${files.length}`);
            try { await editing.upload(files[index], selectedFolder?.id || null); uploaded += 1; }
            catch (err) { failures.push(`${files[index].name}: ${message(err)}`); }
          }
          setUploadErrors(failures); if (uploaded) setReload(n => n + 1);
        } finally { setProgress(''); setMutating(false); }
      }} /></label>}
    </div>
    {manage && <p className="text-xs text-text-secondary">{selectedFolder ? t(`上传到「${selectedFolder.name}」`, `Upload to “${selectedFolder.name}”`) : t('上传到「未分类」；也可先选择或新建目录。', 'Uploads go to Unfiled; select or create a folder to organize them.')} {t('已保存项目及历史版本引用的素材不能删除。', 'Materials referenced by saved projects or versions cannot be deleted.')}</p>}
    {error && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}
    {!!uploadErrors.length && <p role="alert" className="whitespace-pre-line text-sm text-status-failed-fg">{uploadErrors.join('\n')}</p>}
    {busy && <p role="status" className="text-sm text-text-secondary">{progress || t('正在处理…', 'Working…')}</p>}
    {!busy && !items.length && <p className="text-sm text-text-secondary">{t('当前目录没有素材。', 'No materials in this folder.')}</p>}
    {childFolders.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('子目录', 'Subfolders')}>{childFolders.map(folder => <button type="button" key={folder.id} className="group flex min-h-28 items-center gap-3 rounded-xl border border-glass-border bg-surface p-4 text-left hover:border-primary/60" onClick={() => setFolderId(folder.id)}><Folder size={28} className="text-primary" /><span className="min-w-0 flex-1 truncate font-medium">{folder.name}</span><ChevronRight size={18} className="text-text-muted transition-transform group-hover:translate-x-1" /></button>)}</div>}
    <div className={manage ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4' : 'flex min-w-0 flex-col gap-2'}>{items.map(item => <article className={`group relative min-w-0 overflow-hidden rounded-xl border border-glass-border bg-surface ${manage ? '' : 'flex items-center gap-2 p-2'}`} key={item.id}>
      <div className={`relative overflow-hidden bg-black/40 ${manage ? 'aspect-video' : 'h-16 w-24 shrink-0 rounded-md'}`}>
        {item.video ? <video className="h-full w-full object-cover" src={item.url} poster={getVideoPosterUrl(item.url) || undefined} muted preload="metadata" aria-label={item.name} /> : <div className="flex h-full items-center justify-center text-text-muted"><Music size={24} aria-hidden="true" /></div>}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="pointer-events-none absolute bottom-1 left-1 right-1 truncate text-[10px] text-white">{item.name} · {item.duration_ms > 0 ? `${(item.duration_ms / 1000).toFixed(1)}s` : t('打开后查看时长', 'Open to inspect duration')}</span>
          {onSelect && <button type="button" className="min-h-11 min-w-11 rounded-full bg-primary p-3 text-white" aria-label={`${t('添加素材', 'Add material')} ${item.name}`} title={t('添加到时间线', 'Add to timeline')} disabled={busy || disabled} onClick={() => void run(async () => { onSelect(await editing.material(item.id)); })}><Plus size={18} aria-hidden="true" /></button>}
          {manage && item.deletable && <button type="button" className="rounded-full bg-red-500/80 p-3 text-white" aria-label={`${t('删除素材', 'Delete material')} ${item.name}`} disabled={busy} onClick={() => { if (window.confirm(t(`确认删除「${item.name}」？`, `Delete “${item.name}”?`))) void run(async () => { await editing.deleteMaterial(item.id); setReload(n => n + 1); }); }}><Trash2 size={16} /></button>}
          {!item.deletable && manage && <span className="rounded-full bg-black/60 p-3 text-text-muted" title={t('来源素材不可删除', 'Source material is read-only')}><Lock size={16} /></span>}
        </div>
      </div>
      <div className={manage ? 'p-3' : 'min-w-0 flex-1'}><p className="truncate font-medium" title={item.name}>{item.name}</p>
      <p className="text-xs text-text-muted">{item.folder_name || t('未分类', 'Unfiled')} · {item.origin === 'generated' ? t('生成素材', 'Generated') : t('上传素材', 'Uploaded')}</p>
      {manage && <div className="mt-2 flex items-center gap-2"><FolderInput size={14} className="shrink-0 text-text-muted" /><select className="glass-input min-w-0 flex-1 px-2 py-2 text-xs" aria-label={`${t('移动素材', 'Move material')} ${item.name}`} value={item.folder_id || ''} disabled={busy} onChange={event => { const target = event.target.value || null; void run(async () => { await editing.moveMaterial(item.id, target); setItems(old => old.map(current => current.id === item.id ? { ...current, folder_id: target, folder_name: folders.find(folder => folder.id === target)?.name || null } : current)); setReload(n => n + 1); }); }}><option value="">{t('未分类', 'Unfiled')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div>}
      </div>
    </article>)}</div>
    {cursor !== null && <button type="button" className="glass-button min-h-11 px-3 py-2" disabled={busy} onClick={() => void run(async () => { const page = await editing.materials(query, cursor, folderId || '__root'); setItems(old => [...old, ...page.items]); setCursor(page.next_cursor); })}>{t('加载更多', 'Load more')}</button>}
  </section>;
}
