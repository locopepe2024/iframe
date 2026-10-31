'use client';
import { useEffect, useState } from 'react';
import { createRenderRequestId } from '@/lib/renderRequestId';
import { useLocale } from 'next-intl';
import { editing, type EditMaterial, type EditProject } from '@/lib/editing';
import type { AssemblyEditPlan } from '@/lib/api';
import { AssemblyTracks } from '../AssemblyTracks';
import { extractErrorDetail, getAssetUrl } from '@/lib/utils';

export { EditingMaterials, EditingMaterialManager } from './EditingMaterials';
import { EditingMaterials, EditingMaterialManager } from './EditingMaterials';

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
  const [tab, setTab] = useState<'edit' | 'materials'>('edit');
  useEffect(() => { const read = () => setTab(new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab') === 'materials' ? 'materials' : 'edit'); read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read); }, []);
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
    const clip = { id: createRenderRequestId(), timeline_start_ms: start, timeline_end_ms: start + duration, source_start_ms: 0, source_end_ms: duration, source_media_id: item.id, source_refs: [`media:${item.id}`], label: item.name, enabled: true, gain: 1 };
    const lanes = lane ? current.lanes.map(l => l.id === lane.id ? { ...l, clips: [...l.clips, clip] } : l) : [...current.lanes, { id: createRenderRequestId(), kind, label: kind, allow_overlap: kind !== 'video', clips: [clip] }];
    if (lanes.length > 8) { setError(t('最多支持 8 条泳道。', 'At most 8 lanes.')); return; }
    setSources(old => ({ ...old, [item.id]: item }));
    change({ ...current, lanes, target_duration_ms: item.video ? start + duration : current.target_duration_ms });
  };
  const importMaterials = () => { setTab('materials'); window.location.hash = '#/editing?tab=materials'; };
  const deleteCurrentProject = () => {
    if (!project || dirty || busy) return;
    if (!window.confirm(t('删除这个剪辑项目？项目源素材不会被删除。', 'Delete this editing project? Source materials will remain.'))) return;
    void run(async () => {
      await editing.delete(project.id);
      setProjects(old => old.filter(item => item.id !== project.id));
      setProject(null); setPlan(null); setSources({}); setVersions([]); setDirty(false);
    });
  };
  return <div className="h-full space-y-5 overflow-y-auto p-4 md:p-7">
    <div className="flex flex-wrap items-center gap-2"><h1 className="font-display mr-3 text-2xl font-semibold">{t('独立剪辑', 'Independent editing')}</h1><button type="button" className="glass-button px-3 py-2" aria-pressed={tab === 'edit'} onClick={() => { setTab('edit'); window.location.hash = '#/editing'; }}>{t('剪辑工作区', 'Editing')}</button><button type="button" className="glass-button px-3 py-2" aria-pressed={tab === 'materials'} onClick={() => { setTab('materials'); window.location.hash = '#/editing?tab=materials'; }}>{t('素材管理', 'Materials')}</button></div>
    <p className="text-sm text-text-secondary">{tab === 'materials' ? t('管理上传素材和目录；生成素材仍由来源项目维护。', 'Manage uploaded materials and folders; generated materials remain owned by their source project.') : t('从素材库选择视频，按顺序剪辑，添加音轨和字幕后合成。', 'Select videos, arrange the sequence, add audio and captions, then render.')}</p>
    {tab === 'materials' ? <EditingMaterialManager onSelect={item => { add(item); setTab('edit'); window.location.hash = '#/editing'; }} disabled={!project || busy} /> : <>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <select className="glass-input px-3 py-2" aria-label={t('剪辑项目', 'Editing project')} disabled={busy || dirty} value={project?.id || ''} onChange={e => { const id = e.target.value; if (id) void run(async () => accept(await editing.get(id))); }}><option value="">{t('选择项目', 'Select project')}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
      {project && <button className="glass-button px-3 py-2 text-red-300" title={dirty ? t('请先保存或放弃未保存修改', 'Save or discard unsaved changes first') : t('删除当前剪辑项目', 'Delete current editing project')} disabled={busy || dirty} onClick={deleteCurrentProject}>{t('删除项目', 'Delete project')}</button>}
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
        {plan && <>
          <AssemblyTracks plan={plan} resourceId={project.id} saved={!dirty} project={{ id: project.id, frames: [], video_tasks: [] }} materials={sources} materialPanel={<EditingMaterials onSelect={add} onImport={importMaterials} materials={sources} disabled={busy} />} onChange={change}
            audioLane={audioLane} onAudioLaneChange={setAudioLane} canUndo={undo.length > 0} canRedo={redo.length > 0}
            onUndo={() => { setRedo(old => [...old, plan]); setPlan(undo[undo.length - 1]); setUndo(old => old.slice(0, -1)); setDirty(true); }}
            onRedo={() => { setUndo(old => [...old, plan]); setPlan(redo[redo.length - 1]); setRedo(old => old.slice(0, -1)); setDirty(true); }}
            onExportSubtitles={lane => editing.subtitles(project.id, lane)} onUploadAudio={async file => { const item = await editing.upload(file); setSources(old => ({ ...old, [item.id]: item })); return { media_id: item.id, url: item.url, duration_ms: item.duration_ms }; }} />
        </>}
        {!plan && <EditingMaterials onSelect={add} onImport={importMaterials} materials={sources} disabled={busy} />}
      </fieldset>
    </>}
    </>}
  </div>;
}
