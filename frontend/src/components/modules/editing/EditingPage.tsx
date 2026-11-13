'use client';
import { useEffect, useState } from 'react';
import { Clapperboard, Download, FolderOpen, History, Mic, Plus, RotateCcw, Save, Scissors, Trash2 } from 'lucide-react';
import { EditingProjectActions, EditingProjectDialog } from './EditingProjectControls';
import { createRenderRequestId } from '@/lib/renderRequestId';
import { useLocale } from 'next-intl';
import { editing, type EditMaterial, type EditProject } from '@/lib/editing';
import type { AssemblyClip, AssemblyEditPlan } from '@/lib/api';
import { AssemblyTracks } from '../AssemblyTracks';
import { extractErrorDetail, getAssetUrl } from '@/lib/utils';
import { continueEditingNavigation, registerEditingNavigationGuard } from '@/lib/editingNavigationGuard';

export { EditingMaterials, EditingMaterialManager } from './EditingMaterials';
import { EditingMaterials, EditingMaterialManager, EditingMaterialPicker } from './EditingMaterials';
import EditingTranscriptionDialog from './EditingTranscriptionDialog';
import EditingVoiceoverDialog from './EditingVoiceoverDialog';
import type { TranscriptCue } from './transcriptDraft';

export default function EditingPage() {
  const zh = useLocale().startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const [projects, setProjects] = useState<EditProject[]>([]);
  const [project, setProject] = useState<EditProject | null>(null);
  const [plan, setPlan] = useState<AssemblyEditPlan | null>(null);
  const [sources, setSources] = useState<Record<string, EditMaterial>>({});
  const [title, setTitle] = useState('');
  const [projectDialog, setProjectDialog] = useState<'new' | 'history' | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState('');
  const [undo, setUndo] = useState<AssemblyEditPlan[]>([]);
  const [redo, setRedo] = useState<AssemblyEditPlan[]>([]);
  const [versions, setVersions] = useState<{ revision: number }[]>([]);
  const [pendingMedia, setPendingMedia] = useState('');
  const [tab, setTab] = useState<'edit' | 'materials'>('edit');
  const [importOpen, setImportOpen] = useState(false);
  const [transcriptClip, setTranscriptClip] = useState<AssemblyClip | null>(null);
  const [voiceoverOpen, setVoiceoverOpen] = useState(false);
  useEffect(() => { const read = () => setTab(new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab') === 'materials' ? 'materials' : 'edit'); read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read); }, []);
  useEffect(() => { const read = () => setPendingMedia(new URLSearchParams(window.location.hash.split('?')[1] || '').get('media') || ''); read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read); }, []);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  useEffect(() => registerEditingNavigationGuard({ isDirty: () => dirty, isBusy: () => busy, onLeaveRequest: target => { setLeaveError(''); setPendingLeave(target); } }), [dirty, busy]);
  useEffect(() => {
    if (!pendingLeave || busy || dirty) return;
    const target = pendingLeave;
    setPendingLeave(null);
    continueEditingNavigation(target);
  }, [pendingLeave, busy, dirty]);
  const [audioLane, setAudioLane] = useState<'bgm' | 'dialogue' | 'sfx'>('bgm');
  const emptyPlan = (id: string): AssemblyEditPlan => ({ id: `assembly-${id}`, scope: 'project', revision: 1, target_duration_ms: 1000, lanes: [], markers: [], provenance: {} });
  const accept = (p: EditProject) => { setProject(p); setPlan(p.plan || emptyPlan(p.id)); setSources(p.sources); setDirty(false); setUndo([]); setRedo([]); setVersions([]); setProjectDialog(null); setTranscriptClip(null); setVoiceoverOpen(false); };
  useEffect(() => { editing.list().then(setProjects).catch(e => setError(extractErrorDetail(e))); }, []);
  // Older projects can contain a saved timeline reference without the
  // corresponding source snapshot in `sources` (for example, after a
  // migration or an interrupted import). Hydrate those references when the
  // project is opened so the preview can resolve the current video instead of
  // treating the playhead as an empty position.
  useEffect(() => {
    if (!project || !plan) return;
    const ids = Array.from(new Set(plan.lanes.flatMap(lane => lane.clips
      .filter(clip => lane.kind !== 'subtitle' && lane.kind !== 'markers' && clip.source_media_id)
      .map(clip => clip.source_media_id as string))));
    const missing = ids.filter(id => !sources[id]?.url);
    if (!missing.length) return;
    let active = true;
    void Promise.all(missing.map(id => editing.material(id))).then(items => {
      if (!active) return;
      setSources(current => ({ ...current, ...Object.fromEntries(items.map(item => [item.id, item])) }));
    }).catch(error => { if (active) setError(extractErrorDetail(error)); });
    return () => { active = false; };
  }, [project?.id, plan, sources]);
  const run = async (fn: () => Promise<void>, reportError = setError) => { setBusy(true); reportError(''); try { await fn(); } catch (e) { reportError(extractErrorDetail(e)); } finally { setBusy(false); } };
  const saveAndLeave = async () => {
    if (!pendingLeave || !project || !plan || busy) return;
    const target = pendingLeave;
    setBusy(true); setLeaveError('');
    try {
      accept(await editing.save(project.id, project.revision, plan));
      setPendingLeave(null);
      continueEditingNavigation(target);
    } catch (e) { setLeaveError(extractErrorDetail(e)); }
    finally { setBusy(false); }
  };
  const discardAndLeave = () => {
    if (!pendingLeave || busy) return;
    const target = pendingLeave;
    setPendingLeave(null);
    continueEditingNavigation(target);
  };
  const change = (next: AssemblyEditPlan) => { if (busy) return; if (plan) setUndo(old => [...old.slice(-49), plan]); setRedo([]); setPlan(next); setDirty(true); };
  const addTranscript = (cues: TranscriptCue[]) => {
    if (!plan || !transcriptClip || plan.lanes.length >= 8 || !plan.lanes.some(lane => lane.kind === 'video' && lane.clips.some(clip => clip.id === transcriptClip.id))) return;
    change({ ...plan, lanes: [...plan.lanes, {
      id: createRenderRequestId(), kind: 'subtitle', label: t('原声字幕', 'Source captions'), allow_overlap: false,
      clips: cues.map(cue => ({ id: createRenderRequestId(), timeline_start_ms: cue.start_ms, timeline_end_ms: cue.end_ms, text: cue.text.trim(), source_refs: [...transcriptClip.source_refs], enabled: true })),
    }] });
    setTranscriptClip(null);
  };
  const add = (item: EditMaterial, laneOverride?: 'bgm' | 'dialogue' | 'sfx') => {
    if (!project) return;
    if (!item.video && !plan) { setError(t('请先添加视频。', 'Add a video first.')); return; }
    const current: AssemblyEditPlan = plan || { id: `assembly-${project.id}`, scope: 'project', revision: 1, target_duration_ms: item.duration_ms, lanes: [], markers: [], provenance: {} };
    const kind: 'video' | 'bgm' | 'dialogue' | 'sfx' = item.video ? 'video' : laneOverride || audioLane;
    const lane = current.lanes.find(l => l.kind === kind);
    const hasVideo = current.lanes.some(l => l.kind === 'video' && l.clips.length > 0);
    const start = item.video && hasVideo ? current.target_duration_ms : 0;
    const duration = item.video ? item.duration_ms : Math.min(item.duration_ms, current.target_duration_ms);
    const clip = { id: createRenderRequestId(), timeline_start_ms: start, timeline_end_ms: start + duration, source_start_ms: 0, source_end_ms: duration, source_media_id: item.id, source_refs: [`media:${item.id}`], label: item.name, enabled: true, gain: 1 };
    const lanes = lane ? current.lanes.map(l => l.id === lane.id ? { ...l, clips: [...l.clips, clip] } : l) : [...current.lanes, { id: createRenderRequestId(), kind, label: kind, allow_overlap: kind !== 'video', clips: [clip] }];
    if (lanes.length > 8) { setError(t('最多支持 8 条泳道。', 'At most 8 lanes.')); return; }
    setSources(old => ({ ...old, [item.id]: item }));
    change({ ...current, lanes, target_duration_ms: item.video ? start + duration : current.target_duration_ms });
  };
  const importToWorkspace = async (item: EditMaterial) => {
    if (!project) return;
    setBusy(true);
    try {
      const updated = await editing.importMaterial(project.id, project.revision, item.id);
      setProject(updated);
      setSources(current => ({ ...current, ...updated.sources }));
      setImportOpen(false);
    } finally { setBusy(false); }
  };
  const importMaterials = () => { setImportOpen(true); };
  const deleteCurrentProject = () => {
    if (!project || dirty || busy) return;
    if (!window.confirm(t('删除这个剪辑项目？项目源素材不会被删除。', 'Delete this editing project? Source materials will remain.'))) return;
    void run(async () => {
      await editing.delete(project.id);
      setProjects(old => old.filter(item => item.id !== project.id));
      setProject(null); setPlan(null); setSources({}); setVersions([]); setDirty(false);
    });
  };
  const openNewProject = () => { setTitle(''); setDialogError(''); setProjectDialog('new'); };
  const iconButton = 'glass-button flex h-11 w-11 shrink-0 items-center justify-center p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40';
  const menuButton = 'flex min-h-11 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40';
  return <div className="h-full space-y-3 overflow-y-auto p-3 md:p-4">
    {pendingLeave && <div role="dialog" aria-modal="true" aria-labelledby="editing-leave-title" className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-glass-border bg-background p-5 shadow-2xl">
        <h2 id="editing-leave-title" className="text-lg font-semibold">{t('离开剪辑？', 'Leave editing?')}</h2>
        <p className="text-sm text-text-secondary">{busy ? t('当前操作完成后再决定如何离开。', 'Choose how to leave after the current operation finishes.') : t('当前剪辑有未保存的修改。', 'This edit has unsaved changes.')}</p>
        {busy && <p role="status" className="text-sm text-text-secondary">{t('处理中…', 'Finishing current operation…')}</p>}
        {leaveError && <p role="alert" className="text-sm text-red-300">{leaveError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="glass-button min-h-11 px-3 text-sm" onClick={() => { setPendingLeave(null); setLeaveError(''); }}>{t('留在此页', 'Stay')}</button>
          <button type="button" className="glass-button min-h-11 px-3 text-sm" disabled={busy} onClick={discardAndLeave}>{t('放弃并离开', 'Discard and leave')}</button>
          <button type="button" className="min-h-11 rounded-lg bg-primary px-3 text-sm text-white disabled:opacity-40" disabled={busy || !dirty || !project || !plan} onClick={() => void saveAndLeave()}>{busy ? t('处理中…', 'Processing…') : t('保存并离开', 'Save and leave')}</button>
        </div>
      </div>
    </div>}
    <h1 className="sr-only">{t('独立剪辑', 'Independent editing')}</h1>
    <header className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border border-glass-border bg-white/[0.02] p-2 xl:flex xl:items-center" aria-label={t('剪辑工作区工具栏', 'Editing workspace toolbar')}>
      <nav className="flex shrink-0 items-center gap-1" aria-label={t('剪辑视图', 'Editing views')}>
        <button type="button" className="glass-button flex h-11 min-w-11 items-center justify-center gap-2 px-3 text-sm aria-pressed:bg-white/10" aria-label={t('剪辑工作区', 'Editing')} title={t('剪辑工作区', 'Editing')} aria-pressed={tab === 'edit'} onClick={() => { setTab('edit'); window.location.hash = '#/editing'; }}><Scissors size={16} aria-hidden="true" /><span className="hidden sm:inline">{t('剪辑', 'Editing')}</span></button>
        <button type="button" className="glass-button flex h-11 min-w-11 items-center justify-center gap-2 px-3 text-sm aria-pressed:bg-white/10" aria-label={t('素材管理', 'Materials')} title={t('素材管理', 'Materials')} aria-pressed={tab === 'materials'} onClick={() => { setTab('materials'); window.location.hash = '#/editing?tab=materials'; }}><FolderOpen size={16} aria-hidden="true" /><span className="hidden sm:inline">{t('素材', 'Materials')}</span></button>
      </nav>
      {tab === 'edit' && <>
        <div className="flex min-w-0 items-start gap-1 xl:flex-1 xl:items-center xl:border-l xl:border-glass-border xl:pl-2">
          <div className="min-w-0 flex-1 xl:flex xl:items-center xl:gap-2">
            <select className="glass-input h-11 w-full min-w-0 truncate px-2 text-sm disabled:opacity-40 xl:max-w-48" aria-label={t('剪辑项目', 'Editing project')} disabled={busy || dirty} value={project?.id || ''} onChange={e => { const id = e.target.value; if (id) void run(async () => accept(await editing.get(id))); }}><option value="">{t('选择项目', 'Select project')}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
            {project && <span role="status" className="block whitespace-nowrap px-1 text-xs text-text-secondary">{t('版本', 'Revision')} {project.revision}{dirty ? t(' · 未保存', ' · Unsaved') : ''}</span>}
          </div>
          <EditingProjectActions label={t('项目操作', 'Project actions')}>
            <button type="button" className={menuButton} disabled={busy || dirty} onClick={openNewProject}><Plus size={16} aria-hidden="true" />{t('新建剪辑', 'New edit')}</button>
            {project && <>
              <button type="button" className={menuButton} disabled={busy} onClick={() => void run(async () => accept(await editing.get(project.id)))}><RotateCcw size={16} aria-hidden="true" />{t('重新加载 / 放弃修改', 'Reload / discard changes')}</button>
              <button type="button" className={menuButton} disabled={busy || dirty} onClick={() => { setVersions([]); setDialogError(''); setProjectDialog('history'); void run(async () => setVersions(await editing.versions(project.id)), setDialogError); }}><History size={16} aria-hidden="true" />{t('版本历史', 'Version history')}</button>
              <div className="border-t border-glass-border" />
              <button type="button" className={`${menuButton} text-red-300`} title={dirty ? t('请先保存或放弃未保存修改', 'Save or discard unsaved changes first') : t('删除当前剪辑项目', 'Delete current editing project')} disabled={busy || dirty} onClick={deleteCurrentProject}><Trash2 size={16} aria-hidden="true" />{t('删除项目', 'Delete project')}</button>
            </>}
          </EditingProjectActions>
        </div>
        {project && <div className="col-span-2 flex items-center justify-end gap-2 xl:ml-auto">
          <button type="button" className={iconButton} aria-label={t('生成配音', 'Generate voiceover')} title={t('生成配音', 'Generate voiceover')} disabled={busy || !plan?.lanes.some(lane => lane.kind === 'video' && lane.clips.length > 0) || (plan.lanes.length >= 8 && !plan.lanes.some(lane => lane.kind === 'dialogue'))} onClick={() => setVoiceoverOpen(true)}><Mic size={18} aria-hidden="true" /></button>
          <button type="button" className={iconButton} aria-label={t('保存剪辑', 'Save edit')} title={t('保存剪辑', 'Save edit')} disabled={busy || !plan || !dirty} onClick={() => void run(async () => accept(await editing.save(project.id, project.revision, plan!)))}><Save size={18} aria-hidden="true" /></button>
          <button type="button" className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm text-white hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40" disabled={busy || dirty || !plan} title={dirty ? t('请先保存剪辑', 'Save the edit first') : undefined} onClick={() => void run(async () => accept(await editing.render(project.id, project.revision)))}><Clapperboard size={16} aria-hidden="true" />{busy ? t('处理中…', 'Processing…') : t('合成 MP4', 'Render MP4')}</button>
          {project.output && !dirty && <a className={iconButton} href={getAssetUrl(project.output.url)} download aria-label={`${t('下载成片', 'Download output')} · v${project.output.revision}`} title={`${t('下载成片', 'Download output')} · v${project.output.revision}`}><Download size={18} aria-hidden="true" /></a>}
        </div>}
      </>}
    </header>
    {importOpen && <EditingMaterialPicker onSelect={importToWorkspace} onClose={() => setImportOpen(false)} />}
    {transcriptClip && <EditingTranscriptionDialog clip={transcriptClip} onClose={() => setTranscriptClip(null)} onApply={addTranscript} />}
    {voiceoverOpen && <EditingVoiceoverDialog onClose={() => setVoiceoverOpen(false)} onCreated={item => { add(item, 'dialogue'); setVoiceoverOpen(false); }} />}
    {tab === 'materials' ? <><p className="text-sm text-text-secondary">{t('管理上传素材和目录；生成素材仍由来源项目维护。', 'Manage uploaded materials and folders; generated materials remain owned by their source project.')}</p><EditingMaterialManager /></> : <>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {projectDialog && <EditingProjectDialog title={projectDialog === 'new' ? t('新建剪辑', 'New edit') : t('版本历史', 'Version history')} closeLabel={t('关闭', 'Close')} busy={busy} onClose={() => setProjectDialog(null)}>
      {projectDialog === 'new' ? <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        if (busy || dirty || !title.trim()) return;
        void run(async () => { const p = await editing.create(title.trim()); setProjects(old => [p, ...old]); accept(p); setTitle(''); }, setDialogError);
      }}>
        <label className="block text-sm">{t('新剪辑名称', 'New edit title')}<input className="glass-input mt-2 h-11 w-full px-3" maxLength={120} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
        {dialogError && <p role="alert" className="text-sm text-red-300">{dialogError}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="glass-button min-h-11 px-3 text-sm" disabled={busy} onClick={() => setProjectDialog(null)}>{t('取消', 'Cancel')}</button><button type="submit" className="glass-button min-h-11 px-3 text-sm" disabled={busy || dirty || !title.trim()}>{busy ? t('创建中…', 'Creating…') : t('创建独立项目', 'Create independent project')}</button></div>
      </form> : <div className="space-y-3">
        {busy && <p role="status" className="text-sm text-text-secondary">{t('处理中…', 'Processing…')}</p>}
        {dialogError && <p role="alert" className="text-sm text-red-300">{dialogError}</p>}
        {!busy && !dialogError && versions.every(v => v.revision <= 0) && <p className="text-sm text-text-secondary">{t('暂无已保存版本', 'No saved versions yet')}</p>}
        {versions.filter(v => v.revision > 0).map(v => <div key={v.revision} className="flex items-center justify-between gap-3 text-sm"><span>{t('版本', 'Revision')} {v.revision}{v.revision === project?.revision ? t(' · 当前', ' · Current') : ''}</span><button type="button" className="glass-button min-h-11 px-3" disabled={busy || dirty || v.revision === project?.revision} onClick={() => { if (project) void run(async () => accept(await editing.restore(project.id, project.revision, v.revision)), setDialogError); }}>{t('恢复', 'Restore')} v{v.revision}</button></div>)}
      </div>}
    </EditingProjectDialog>}
    {!project && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-glass-border p-4"><p className="flex-1 text-sm text-text-secondary">{t('选择或新建剪辑，从素材库添加视频、音轨和字幕后合成。', 'Select or create an edit, then add videos, audio and captions from your library.')}</p><button type="button" className="glass-button flex min-h-11 items-center gap-2 px-3 text-sm" disabled={busy || dirty} onClick={openNewProject}><Plus size={16} aria-hidden="true" />{t('新建剪辑', 'New edit')}</button></div>}
    {pendingMedia && <button className="glass-button px-3 py-2" disabled={!project || busy} onClick={() => void run(async () => { add(await editing.material(pendingMedia)); setPendingMedia(''); })}>{t('添加素材库中选定的素材（先选择或创建剪辑项目）', 'Add selected library material (select or create an editing project first)')}</button>}
    {project && <>
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        {plan && <>
          <AssemblyTracks plan={plan} resourceId={project.id} disabled={busy} saved={!dirty} project={{ id: project.id, frames: [], video_tasks: [] }} materials={sources} onImport={importMaterials} materialPanel={<EditingMaterials onSelect={add} materials={sources} disabled={busy} />} onChange={change} onTranscribe={clip => { if (plan.lanes.length >= 8) setError(t('最多支持 8 条泳道。', 'At most 8 lanes.')); else setTranscriptClip(clip); }}
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
