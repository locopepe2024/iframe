'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { editing, type EditMaterial, type EditProject } from '@/lib/editing';
import type { AssemblyEditPlan } from '@/lib/api';
import { AssemblyTracks } from '../AssemblyTracks';
import { extractErrorDetail, getAssetUrl } from '@/lib/utils';

export function EditingMaterials({ onSelect, disabled = false }: { onSelect: (item: EditMaterial) => void; disabled?: boolean }) {
  const zh = useLocale().startsWith('zh');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<EditMaterial[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { let active = true; setBusy(true);
    editing.materials(query).then(page => { if (active) { setItems(page.items); setCursor(page.next_cursor); setError(''); } }).catch(e => { if (active) setError(extractErrorDetail(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [query, reload]);
  return <section className="glass-panel space-y-3 rounded-xl p-4" aria-label={zh ? '剪辑素材库' : 'Editing materials'}>
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="font-semibold">{zh ? '剪辑素材库' : 'Editing materials'}</h2>
      <input className="glass-input px-3 py-2" aria-label={zh ? '搜索剪辑素材' : 'Search editing materials'} value={query} onChange={e => setQuery(e.target.value)} />
      <label className="glass-button cursor-pointer px-3 py-2">{zh ? '上传视频或音频' : 'Upload video or audio'}<input className="sr-only" type="file" accept="video/*,audio/*" disabled={busy || disabled} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setBusy(true); try { await editing.upload(file); setReload(n => n + 1); } catch (err) { setError(extractErrorDetail(err)); } finally { setBusy(false); } }} /></label>
    </div>
    <p className="text-xs text-text-secondary">{zh ? '添加素材只引用当前版本；剪辑保存在独立项目中。生成成片会明确标记为生成素材。' : 'Materials are referenced at their current version. Edits are saved in a separate project. Rendered outputs are labeled as generated.'}</p>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">{zh ? '正在读取素材…' : 'Loading materials…'}</p>}
    {!busy && !items.length && <p>{zh ? '暂无素材，请上传视频。' : 'No materials. Upload a video to begin.'}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map(item => <article className="rounded-lg border border-glass-border p-3" key={item.id}>
      <p className="truncate font-medium" title={item.name}>{item.name}</p>
      <p className="text-xs text-text-muted">{item.origin === 'generated' ? (zh ? '生成素材' : 'Generated') : (zh ? '上传素材' : 'Uploaded')}</p>
      <details className="my-2 break-all text-xs text-text-muted"><summary>{zh ? '素材身份' : 'Material identity'}</summary>{item.id}<br />SHA256: {item.sha256 || (zh ? '添加时固定校验值' : 'Captured when added')}</details>
      <button type="button" className="glass-button px-3 py-2" disabled={busy || disabled} onClick={async () => { setBusy(true); try { onSelect(await editing.material(item.id)); } catch (err) { setError(extractErrorDetail(err)); } finally { setBusy(false); } }}>{zh ? '选择素材' : 'Select material'}</button>
    </article>)}</div>
    {cursor !== null && <button className="glass-button px-3 py-2" disabled={busy} onClick={async () => { setBusy(true); try { const page = await editing.materials(query, cursor); setItems(old => [...old, ...page.items]); setCursor(page.next_cursor); } catch (err) { setError(extractErrorDetail(err)); } finally { setBusy(false); } }}>{zh ? '加载更多' : 'Load more'}</button>}
  </section>;
}

export default function EditingPage() {
  const zh = useLocale().startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const [projects, setProjects] = useState<EditProject[]>([]);
  const [project, setProject] = useState<EditProject | null>(null);
  const [plan, setPlan] = useState<AssemblyEditPlan | null>(null);
  const [sources, setSources] = useState<Record<string, EditMaterial>>({});
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [undo, setUndo] = useState<AssemblyEditPlan[]>([]);
  const [redo, setRedo] = useState<AssemblyEditPlan[]>([]);
  const [versions, setVersions] = useState<{ revision: number }[]>([]);
  const [pendingMedia, setPendingMedia] = useState('');
  useEffect(() => { const read = () => setPendingMedia(new URLSearchParams(window.location.hash.split('?')[1] || '').get('media') || ''); read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read); }, []);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const [audioLane, setAudioLane] = useState<'bgm' | 'dialogue' | 'sfx'>('bgm');
  const accept = (p: EditProject) => { setProject(p); setPlan(p.plan); setSources(p.sources); setDirty(false); setUndo([]); setRedo([]); setVersions([]); };
  useEffect(() => { editing.list().then(setProjects).catch(e => setError(extractErrorDetail(e))); }, []);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(extractErrorDetail(e)); } finally { setBusy(false); } };
  const change = (next: AssemblyEditPlan) => { if (plan) setUndo(old => [...old.slice(-49), plan]); setRedo([]); setPlan(next); setDirty(true); };
  const add = (item: EditMaterial) => {
    if (!project) return;
    if (!item.video && !plan) { setError(t('请先添加视频。', 'Add a video first.')); return; }
    const current: AssemblyEditPlan = plan || { id: `assembly-${project.id}`, scope: 'project', revision: 1, target_duration_ms: item.duration_ms, lanes: [], markers: [], provenance: {} };
    const kind: 'video' | 'bgm' | 'dialogue' | 'sfx' = item.video ? 'video' : audioLane;
    const lane = current.lanes.find(l => l.kind === kind);
    const start = item.video && plan ? plan.target_duration_ms : 0;
    const duration = item.video ? item.duration_ms : Math.min(item.duration_ms, current.target_duration_ms);
    const clip = { id: crypto.randomUUID(), timeline_start_ms: start, timeline_end_ms: start + duration, source_start_ms: 0, source_end_ms: duration, source_media_id: item.id, source_refs: [`media:${item.id}`], label: item.name, enabled: true, gain: 1 };
    const lanes = lane ? current.lanes.map(l => l.id === lane.id ? { ...l, clips: [...l.clips, clip] } : l) : [...current.lanes, { id: crypto.randomUUID(), kind, label: kind, allow_overlap: kind !== 'video', clips: [clip] }];
    if (lanes.length > 8) { setError(t('最多支持 8 条泳道。', 'At most 8 lanes.')); return; }
    setSources(old => ({ ...old, [item.id]: item }));
    change({ ...current, lanes, target_duration_ms: item.video ? start + duration : current.target_duration_ms });
  };
  return <div className="h-full space-y-5 overflow-y-auto p-4 md:p-7">
    <h1 className="font-display text-2xl font-semibold">{t('独立剪辑', 'Independent editing')}</h1>
    <p className="text-sm text-text-secondary">{t('从素材库选择或上传视频，按顺序剪辑，添加音轨和字幕后合成。', 'Select or upload videos, arrange the sequence, add audio and captions, then render.')}</p>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <select className="glass-input px-3 py-2" aria-label={t('剪辑项目', 'Editing project')} disabled={busy || dirty} value={project?.id || ''} onChange={e => { const id = e.target.value; if (id) void run(async () => accept(await editing.get(id))); }}><option value="">{t('选择项目', 'Select project')}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
      <input className="glass-input px-3 py-2" aria-label={t('新剪辑名称', 'New edit title')} maxLength={120} placeholder={t('新剪辑名称', 'New edit title')} value={title} onChange={e => setTitle(e.target.value)} />
      <button className="glass-button px-3 py-2" disabled={busy || dirty || !title.trim()} onClick={() => void run(async () => { const p = await editing.create(title.trim()); setProjects(old => [p, ...old]); accept(p); setTitle(''); })}>{t('创建独立项目', 'Create independent project')}</button>
    </div>
    {pendingMedia && <button className="glass-button px-3 py-2" disabled={!project || busy} onClick={() => void run(async () => { add(await editing.material(pendingMedia)); setPendingMedia(''); })}>{t('添加素材库中选定的素材（先选择或创建剪辑项目）', 'Add selected library material (select or create an editing project first)')}</button>}
    {project && <>
      <div className="flex flex-wrap items-center gap-3">
        <span>{project.title} · {t('版本', 'Revision')} {project.revision}{dirty ? t(' · 未保存', ' · Unsaved') : ''}</span>
        <button className="glass-button px-3 py-2" disabled={busy || !plan || !dirty} onClick={() => void run(async () => { const saved = await editing.save(project.id, project.revision, plan!); accept(saved); })}>{t('保存剪辑', 'Save edit')}</button>
        <button className="glass-button px-3 py-2" disabled={busy} onClick={() => void run(async () => accept(await editing.get(project.id)))}>{t('重新加载 / 放弃修改', 'Reload / discard changes')}</button>
        <button className="glass-button px-3 py-2" disabled={busy || dirty || !plan} onClick={() => void run(async () => accept(await editing.render(project.id, project.revision)))}>{busy ? t('处理中…', 'Processing…') : t('合成 MP4', 'Render MP4')}</button>
        <button className="glass-button px-3 py-2" disabled={busy || dirty} onClick={() => void run(async () => setVersions(await editing.versions(project.id)))}>{t('版本历史', 'Version history')}</button>
        {project.output && !dirty && <a className="glass-button px-3 py-2" href={getAssetUrl(project.output.url)} download>{t('下载成片', 'Download output')} · v{project.output.revision}</a>}
      </div>
      {versions.length > 0 && <div className="flex flex-wrap gap-2">{versions.filter(v => v.revision > 0).map(v => <button className="glass-button px-3 py-2" key={v.revision} disabled={busy || dirty || v.revision === project.revision} onClick={() => void run(async () => accept(await editing.restore(project.id, project.revision, v.revision)))}>{t('恢复', 'Restore')} v{v.revision}</button>)}</div>}
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <label className="text-sm">{t('添加音频到', 'Add audio to')} <select className="glass-input px-3 py-2" value={audioLane} onChange={e => setAudioLane(e.target.value as typeof audioLane)}><option value="bgm">BGM</option><option value="dialogue">{t('对白', 'Dialogue')}</option><option value="sfx">{t('音效', 'SFX')}</option></select></label>
        <EditingMaterials onSelect={add} disabled={busy} />
        {plan && <>
          <div className="flex gap-2"><button className="glass-button px-3 py-2" disabled={!undo.length} onClick={() => { setRedo(old => [...old, plan]); setPlan(undo[undo.length - 1]); setUndo(old => old.slice(0, -1)); setDirty(true); }}>{t('撤销', 'Undo')}</button><button className="glass-button px-3 py-2" disabled={!redo.length} onClick={() => { setUndo(old => [...old, plan]); setPlan(redo[redo.length - 1]); setRedo(old => old.slice(0, -1)); setDirty(true); }}>{t('重做', 'Redo')}</button></div>
          <AssemblyTracks plan={plan} resourceId={project.id} saved={!dirty} project={{ id: project.id, frames: [], video_tasks: [] }} materials={sources} onChange={change}
            onExportSubtitles={lane => editing.subtitles(project.id, lane)} onUploadAudio={async file => { const item = await editing.upload(file); setSources(old => ({ ...old, [item.id]: item })); return { media_id: item.id, url: item.url, duration_ms: item.duration_ms }; }} />
        </>}
      </fieldset>
    </>}
  </div>;
}
