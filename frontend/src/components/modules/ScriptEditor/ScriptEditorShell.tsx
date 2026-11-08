'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EditorContent } from '@tiptap/react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, WifiOff, RotateCcw, X, ListPlus, FolderPlus, Library, WandSparkles, TextCursorInput } from 'lucide-react';
import { api } from '@/lib/api';
import ImportFileDialog from '@/components/series/ImportFileDialog';
import { useEditorStore } from '@/store/editorStore';
import { toast } from '@/store/toastStore';
import { useEditorSetup } from './hooks/useEditorSetup';
import FormatToolbar from './toolbar/FormatToolbar';
import { usePasteHandler } from './hooks/usePasteHandler';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useContinuityCheck } from './hooks/useContinuityCheck';
import { useSceneFolding } from './hooks/useSceneFolding';
import { useViewMode } from './hooks/useViewMode';
import { useOfflineCache } from './hooks/useOfflineCache';
import { useAutoSave } from './hooks/useAutoSave';
import { useDerivation } from './hooks/useDerivation';
import { useL3Completion } from './hooks/useL3Completion';
import { scriptEditorApi } from '@/lib/scriptEditorApi';
import SnapshotListDialog from './dialogs/SnapshotListDialog';
import ScriptWritingDialog from './dialogs/ScriptWritingDialog';
import ScriptOutlineDialog from './dialogs/ScriptOutlineDialog';
import type { WritingWorkspace, ScriptWritingMode } from '@/lib/scriptEditorApi';
import { PasteHintBar } from './components/PasteHintBar';
import { ShortcutHelpPanel } from './components/ShortcutHelpPanel';
import { ContinuityIndicator } from './components/ContinuityIndicator';
import RightPanelContainer from './panels';
import LeftSidebar from './sidebar';
import StoryboardView from './views/StoryboardView';

export interface ScriptEditorShellProps {
  mode?: 'full' | 'embedded' | 'focus';
  projectId?: string;
  scriptDocumentId?: string;
  initialContent?: string | Record<string, unknown> | null;
}

export default function ScriptEditorShell({
  mode = 'full',
  projectId,
  scriptDocumentId,
  initialContent,
}: ScriptEditorShellProps) {
  const t = useTranslations('scriptEditor');
  const { editor, isReady } = useEditorSetup({ content: initialContent });
  const [writingWorkspace, setWritingWorkspace] = useState<WritingWorkspace | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const selectedEpisode = writingWorkspace?.plan?.episodes.find(item => item.document_id === scriptDocumentId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [seriesImportOpen, setSeriesImportOpen] = useState(false);
  const [scriptWritingOpen, setScriptWritingOpen] = useState(false);
  const [scriptWritingMode, setScriptWritingMode] = useState<ScriptWritingMode>('expand_outline');
  const [seriesImportSaving, setSeriesImportSaving] = useState(false);
  const [seriesSourceText, setSeriesSourceText] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [seriesImportError, setSeriesImportError] = useState('');
  const [documentLoading, setDocumentLoading] = useState(Boolean(projectId || scriptDocumentId));
  const [documentLoadFailed, setDocumentLoadFailed] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const { showHint, analysis, applyFormatting, dismissHint } = usePasteHandler(editor);
  const { showShortcutHelp, closeShortcutHelp } = useKeyboardShortcuts(editor);
  const continuityReport = useContinuityCheck(editor);
  const { enabled: foldingEnabled, isAllExpanded, totalScenes: foldingTotal } = useSceneFolding(editor);
  const { mode: viewMode, setMode: setViewMode, isReadOnly, showToolbar, showSidebars } = useViewMode();
  const documentKey = scriptDocumentId || projectId;
  const { hasNewerLocal, restoreFromLocal, dismissLocalRestore, isOffline } = useOfflineCache(documentKey, editor);
  const canPersist = Boolean(documentKey) && !documentLoading && !documentLoadFailed;
  const { save } = useAutoSave(editor, canPersist ? projectId ?? null : null, canPersist ? scriptDocumentId : undefined, projectTitle);
  const refreshDerivation = useDerivation(editor);
  useL3Completion(editor, canPersist ? projectId ?? null : null, canPersist ? scriptDocumentId : undefined);

  const handleSaveSnapshot = useCallback(async () => {
    const result = await save(true);
    if (!result) {
      toast.error(t('toolbar.saveFailed'), { body: t('toolbar.saveFailedHint') });
      return;
    }
    if (result.snapshot_created) {
      toast.success(t('toolbar.saveSuccess'));
    } else {
      toast.warning(t('toolbar.saveWithoutSnapshot'), {
        body: t('toolbar.saveWithoutSnapshotHint'),
      });
    }
  }, [save, t]);

  useEffect(() => {
    if (!projectId) return;
    api.getProject(projectId).then((project) => setProjectTitle(project.title || '剧本'))
      .catch(() => setProjectTitle('剧本'));
  }, [projectId]);

  const isDirty = useEditorStore((s) => s.isDirty);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const wordCount = useEditorStore((s) => s.wordCount);
  const derivedScenes = useEditorStore((s) => s.derivedScenes);
  const currentFormat = useEditorStore((s) => s.currentFormat);
  const currentRendering = useEditorStore((s) => s.currentRendering);
  const leftCollapsed = useEditorStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useEditorStore((s) => s.rightSidebarCollapsed);
  const toggleLeft = useEditorStore((s) => s.toggleLeftSidebar);
  const toggleRight = useEditorStore((s) => s.toggleRightSidebar);

  // The editor is a view over the persisted document. Load it after the
  // Tiptap instance exists, and suppress the update event so loading a saved
  // version does not look like a new edit.
  useEffect(() => {
    if (!editor) return;
    const store = useEditorStore.getState();
    store.setProjectId(projectId ?? null);
    store.setEditorMode(mode);
    store.setViewMode('edit');
    store.setL3Results(null);
    store.setL3Status('idle');
    store.setL3LastFetchTime(null);
    let cancelled = false;

    if (!projectId && !scriptDocumentId) {
      setDocumentLoading(false);
      return () => { cancelled = true; };
    }

    setDocumentLoading(true);
    setDocumentLoadFailed(false);
    store.setLoading(true);
    (scriptDocumentId ? scriptEditorApi.loadScriptDocument(scriptDocumentId) : scriptEditorApi.loadDocument(projectId!))
      .then((response) => {
        if (cancelled) return;
        if (response.title) setProjectTitle(response.title);
        editor.commands.setContent(response.content, { emitUpdate: false });
        refreshDerivation();
        store.setDirty(false);
        store.setLastSavedAt(response.updated_at ? new Date(response.updated_at) : null);
      })
      .catch((error) => {
        if (!cancelled) {
          setDocumentLoadFailed(true);
          toast.error(t('document.loadFailed'));
          console.error('[ScriptEditorShell] Failed to load document:', error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDocumentLoading(false);
          store.setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [editor, projectId, scriptDocumentId, mode, refreshDerivation, t]);

  useEffect(() => {
    editor?.setEditable(canPersist && !isReadOnly && !creatingProject && !navigating && !outlineOpen && !scriptWritingOpen);
  }, [editor, canPersist, isReadOnly, creatingProject, navigating, outlineOpen, scriptWritingOpen]);

  const handleRestore = useCallback((content: object) => {
    if (!editor) return;
    editor.commands.setContent(content, { emitUpdate: false });
    refreshDerivation();
    useEditorStore.getState().setDirty(false);
    useEditorStore.getState().setLastSavedAt(new Date());
  }, [editor, refreshDerivation]);

  const beginSeriesImport = useCallback(async () => {
    if (!editor || !canPersist || seriesImportSaving) return;
    setSeriesImportError('');
    setSeriesImportSaving(true);
    try {
      const source = editor.getText({ blockSeparator: '\n' });
      if (!source.trim()) throw new Error('请先整理剧本内容');
      if (!await save(true)) throw new Error(t('toolbar.saveFailed'));
      useEditorStore.getState().setDirty(false);
      useEditorStore.getState().setLastSavedAt(new Date());
      setSeriesSourceText(source);
      setSeriesImportOpen(true);
    } catch (error) {
      setSeriesImportError(error instanceof Error ? error.message : '保存剧本失败');
    } finally {
      setSeriesImportSaving(false);
    }
  }, [editor, canPersist, seriesImportSaving, save, t]);

  const handleCreateProject = useCallback(async () => {
    if (!editor || !scriptDocumentId || !canPersist || creatingProject) return;
    setCreatingProject(true);
    try {
      const title = projectTitle.trim() || t('document.untitled');
      if (!await save(false)) throw new Error(t('toolbar.saveFailed'));
      const project = await api.createProject(title, editor.getText({ blockSeparator: '\n' }), true, 'r2v', undefined, scriptDocumentId);
      window.location.hash = `#/project/${project.id}/editor`;
    } catch (error) {
      toast.error(t('document.createFailed'), { body: error instanceof Error ? error.message : t('toolbar.saveFailedHint') });
    } finally {
      setCreatingProject(false);
    }
  }, [editor, scriptDocumentId, canPersist, creatingProject, projectTitle, save, t]);

  const backToLibrary = useCallback(async () => {
    if (useEditorStore.getState().isDirty && !await save(false)) {
      toast.error(t('toolbar.saveFailed'));
      return;
    }
    window.location.hash = '#/studio/editor';
  }, [save, t]);

  const navigateDocument = useCallback(async (id: string) => {
    if (navigating) return;
    setNavigating(true);
    try {
      if (useEditorStore.getState().isDirty && !await save(false)) throw new Error(t('toolbar.saveFailed'));
      setOutlineOpen(false);
      window.location.hash = `#/studio/editor/${id}`;
    } catch (cause) {
      toast.error(t('toolbar.saveFailed'), { body: cause instanceof Error ? cause.message : '' });
    } finally { setNavigating(false); }
  }, [navigating, save, t]);

  const openOutline = useCallback(async () => {
    if (!scriptDocumentId) return;
    try {
      if (useEditorStore.getState().isDirty && !await save(false)) throw new Error(t('toolbar.saveFailed'));
      setWritingWorkspace(await scriptEditorApi.getWritingPlan(scriptDocumentId));
      setOutlineOpen(true);
    } catch (cause) {
      toast.error(t('outlinePlan.failed'), { body: cause instanceof Error ? cause.message : '' });
    }
  }, [scriptDocumentId, save, t]);

  const handleOpenScriptWriting = useCallback(async (nextMode: ScriptWritingMode) => {
    if (isDirty && !await save(false)) {
      toast.error(t('toolbar.saveFailed'));
      return;
    }
    if (scriptDocumentId) {
      try {
        const workspace = await scriptEditorApi.getWritingPlan(scriptDocumentId);
        setWritingWorkspace(workspace);
        if ((!workspace.selected_episode_number && (nextMode === 'expand_outline' || workspace.plan)) || workspace.source_changed) {
          setOutlineOpen(true);
          return;
        }
      } catch (cause) {
        toast.error(t('outlinePlan.failed'));
        return;
      }
    }
    setScriptWritingMode(selectedEpisode && !editor?.getText().trim() ? 'expand_outline' : nextMode);
    setScriptWritingOpen(true);
  }, [isDirty, scriptDocumentId, save, t, selectedEpisode, editor]);

  useEffect(() => {
    if (!scriptDocumentId || documentLoading || documentLoadFailed) return;
    let cancelled = false;
    scriptEditorApi.getWritingPlan(scriptDocumentId).then(workspace => {
      if (!cancelled) setWritingWorkspace(workspace);
    }).catch(() => { if (!cancelled) setWritingWorkspace(null); });
    return () => { cancelled = true; };
  }, [scriptDocumentId, documentLoading, documentLoadFailed]);

  const handleApplyScriptDraft = useCallback(async (draftMode: ScriptWritingMode, draft: string) => {
    if (!editor || !canPersist) throw new Error(t('toolbar.saveFailed'));
    const file = new File([draft], `${projectTitle || '剧本'}.fountain`, { type: 'text/plain' });
    const parsed = await scriptEditorApi.importDocument(file);
    const blocks = parsed?.content?.content;
    if (!Array.isArray(blocks) || blocks.length === 0) throw new Error(t('writing.parseFailed'));
    if (!await save(true)) throw new Error(t('toolbar.saveFailed'));
    if (draftMode === 'expand_outline') {
      editor.commands.setContent(parsed.content);
    } else {
      const end = editor.state.doc.content.size;
      editor.chain().focus().insertContentAt(end, blocks).run();
    }
    refreshDerivation();
    toast.success(t('writing.applied'));
  }, [editor, canPersist, projectTitle, save, refreshDerivation, t]);

  const showLeft = mode === 'full' && !leftCollapsed && showSidebars;
  const showRight = mode === 'full' && !rightCollapsed && showSidebars;
  const hideAllSidebars = mode === 'focus' || viewMode === 'focus';
  const hideLeftOnly = mode === 'embedded';

  const handleShotClick = useCallback((shotId: string) => {
    setViewMode('edit');
    if (editor) {
      const { doc } = editor.state;
      let targetPos: number | null = null;
      doc.descendants((node, pos) => {
        if (node.type.name === 'shotBlock' && node.attrs?.id === shotId) {
          targetPos = pos;
          return false;
        }
      });
      if (targetPos !== null) {
        editor.commands.setTextSelection(targetPos);
        editor.commands.scrollIntoView();
      }
    }
  }, [editor, setViewMode]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#050508]">
      {/* Format Toolbar */}
      {!hideAllSidebars && showToolbar && (
        <FormatToolbar
          editor={editor}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onSave={() => { void handleSaveSnapshot(); }}
          onOpenHistory={() => setHistoryOpen(true)}
          canPersist={canPersist}
        />
      )}

      {/* Top Toolbar */}
      {!hideAllSidebars && showToolbar && (
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
          <div className="flex items-center gap-3">
            {mode === 'full' && (
              <button
                type="button"
                onClick={toggleLeft}
                className="text-text-muted hover:text-foreground transition-colors"
                aria-label="Toggle left sidebar"
              >
                {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
            )}
            <span className="text-sm font-medium text-foreground">
              {t('shell.title')}
            </span>
            {projectId && <span className="text-xs text-text-muted">{t('document.production')} · {projectTitle}</span>}
            {scriptDocumentId && (
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <span>{t('document.authoring')}</span>
                <input aria-label={t('document.title')} value={projectTitle} readOnly={Boolean(selectedEpisode)} disabled={!canPersist || creatingProject}
                  onChange={(event) => {
                    setProjectTitle(event.target.value);
                    useEditorStore.getState().setDirty(true);
                  }}
                  className="h-7 w-48 rounded border border-white/10 bg-transparent px-2 text-sm text-foreground outline-none focus:border-primary/60"
                  maxLength={160} />
              </label>
            )}
          </div>
          <div className="flex items-center gap-3">
            {scriptDocumentId && editor && !documentLoading && (
              <>
                <button type="button" onClick={() => { void backToLibrary(); }} disabled={creatingProject}
                  className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs text-foreground hover:bg-white/10 disabled:opacity-50">
                  <Library size={14} /> {t('document.library')}
                </button>
                <button type="button" onClick={() => { void handleCreateProject(); }}
                  disabled={!canPersist || creatingProject || wordCount === 0}
                  className="flex items-center gap-1 rounded border border-primary/50 bg-primary/15 px-2 py-1 text-xs text-foreground hover:bg-primary/25 disabled:opacity-50">
                  <FolderPlus size={14} /> {t(creatingProject ? 'document.creating' : 'document.createProject')}
                </button>
              </>
            )}
            {documentKey && editor && canPersist && (
              <>
                <button type="button" onClick={() => { void handleOpenScriptWriting('expand_outline'); }}
                  disabled={isOffline || documentLoading}
                  className="flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-foreground hover:bg-primary/20 disabled:opacity-50"
                  title={t('writing.expandTitle')}>
                  <WandSparkles size={14} /> {t('writing.expand')}
                </button>
                <button type="button" onClick={() => { void handleOpenScriptWriting('continue'); }}
                  disabled={isOffline || documentLoading}
                  className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs text-foreground hover:bg-white/10 disabled:opacity-50"
                  title={t('writing.continueTitle')}>
                  <TextCursorInput size={14} /> {t('writing.continue')}
                </button>
                <button type="button" onClick={() => { void beginSeriesImport(); }}
                  disabled={seriesImportSaving}
                  className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs text-foreground hover:bg-white/10 disabled:opacity-50"
                  title="按当前编辑内容预览并创建系列">
                  <ListPlus size={14} /> 创建系列
                </button>
              </>
            )}
            <span className="text-xs text-text-muted">
              {isDirty ? t('status.unsaved') : lastSavedAt ? t('status.savedAt', { time: lastSavedAt.toLocaleTimeString() }) : ''}
            </span>
            {seriesImportError && <span role="alert" className="text-xs text-red-400">{seriesImportError}</span>}
            {mode === 'full' && (
              <button
                type="button"
                onClick={toggleRight}
                className="text-text-muted hover:text-foreground transition-colors"
                aria-label="Toggle right sidebar"
              >
                {rightCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
              </button>
            )}
          </div>
        </div>
      )}

      {scriptDocumentId && writingWorkspace && !hideAllSidebars && (
        <nav aria-label={t('outlinePlan.title')} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2 text-xs">
          <button type="button" onClick={() => void openOutline()} disabled={navigating || !canPersist} className="rounded border border-white/15 px-3 py-1.5 hover:bg-white/10 disabled:opacity-50">{t('outlinePlan.title')}</button>
          <select aria-label={t('outlinePlan.selectEpisode')} value={scriptDocumentId} disabled={navigating || !canPersist}
            onChange={event => void navigateDocument(event.target.value)} className="max-w-md rounded border border-white/15 bg-[#101116] px-2 py-1.5">
            <option value={writingWorkspace.root_document_id}>{t('outlinePlan.root')} · {writingWorkspace.root_title}</option>
            {writingWorkspace.plan?.episodes.map(item => <option key={item.document_id} value={item.document_id}>{t('outlinePlan.episode', { number: item.number })} · {item.title}</option>)}
          </select>
          {selectedEpisode && <span className="text-text-muted">{t('outlinePlan.bodyCount', { count: wordCount })}</span>}
          {writingWorkspace.source_changed && <span className="text-amber-300">{t('outlinePlan.sourceChanged')}</span>}
        </nav>
      )}

      {/* Main content area: Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        {!hideAllSidebars && !hideLeftOnly && showLeft && (
          <aside className="w-[260px] shrink-0 border-r border-white/10 bg-white/[0.02] backdrop-blur-xl overflow-hidden">
            <LeftSidebar editor={editor} />
          </aside>
        )}

        {/* Editor Content Area / Storyboard View */}
        {viewMode === 'storyboard' ? (
          <main className="relative flex-1 min-w-0 overflow-hidden">
            <StoryboardView editor={editor} onShotClick={handleShotClick} />
          </main>
        ) : (
          <main className={`relative flex-1 min-w-0 overflow-y-auto ${
            viewMode === 'focus' ? 'flex items-start justify-center' : ''
          }`}>
            {/* Offline / local restore banner */}
            {isOffline && (
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-amber-900/30 px-4 py-2 text-xs text-amber-200 border-b border-amber-700/30">
                <WifiOff size={14} />
                <span>{t('status.offlineBanner')}</span>
              </div>
            )}
            {hasNewerLocal && (
              <div className="sticky top-0 z-10 flex items-center justify-between bg-blue-900/30 px-4 py-2 text-xs text-blue-200 border-b border-blue-700/30">
                <div className="flex items-center gap-2">
                  <RotateCcw size={14} />
                  <span>{t('status.localCacheFound')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={restoreFromLocal}
                    className="rounded bg-blue-700/60 px-2 py-0.5 text-xs hover:bg-blue-700/80 transition-colors"
                  >
                    {t('status.restore')}
                  </button>
                  <button
                    type="button"
                    onClick={dismissLocalRestore}
                    className="text-blue-300/60 hover:text-blue-200 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}
            {selectedEpisode && (
              <div className="mx-auto mt-6 max-w-[720px] px-4">
                <details key={scriptDocumentId} open={wordCount === 0 ? true : undefined} className="rounded-lg border border-primary/25 bg-primary/[0.04] p-4">
                  <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{t('outlinePlan.episodeBasis')} · {t('outlinePlan.episode', { number: selectedEpisode.number })} · {selectedEpisode.title}</summary>
                  <p className="mt-2 text-xs text-text-muted">{t('outlinePlan.basisHint')}</p>
                  <dl className="mt-4 space-y-3 text-sm">
                    {(['outline', 'opening_state', 'ending_state', 'characters', 'source_excerpt'] as const).map(key => selectedEpisode[key] ? <div key={key}><dt className="text-xs text-text-muted">{t(`outlinePlan.${key === 'characters' ? 'episodeCharacters' : key}`)}</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-6 text-text-secondary">{selectedEpisode[key]}</dd></div> : null)}
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => void openOutline()} className="rounded border border-white/15 px-3 py-2 text-xs hover:bg-white/10">{t('outlinePlan.edit')}</button>
                    <button type="button" onClick={() => void handleOpenScriptWriting(wordCount ? 'continue' : 'expand_outline')} disabled={!canPersist || isOffline} className="rounded bg-primary px-3 py-2 text-xs text-white disabled:opacity-50">{t(wordCount ? 'writing.continue' : 'writing.expand')}</button>
                  </div>
                </details>
              </div>
            )}
            {/* Paste Hint Bar */}
            <PasteHintBar
              visible={showHint}
              analysis={analysis}
              onApply={applyFormatting}
              onDismiss={dismissHint}
            />
            <div
              className={`script-editor script-editor-content mx-auto px-8 py-10 ${
                viewMode === 'focus' ? 'max-w-[860px]' : 'max-w-[720px]'
              }`}
              data-format={currentFormat}
              data-rendering={currentRendering}
            >
              {isReady ? (
                <EditorContent
                  editor={editor}
                  className={`prose prose-invert max-w-none focus:outline-none min-h-[60vh] ${
                    isReadOnly ? 'pointer-events-none opacity-90' : ''
                  }`}
                />
              ) : (
                <div className="flex items-center justify-center h-40 text-text-muted text-sm">
                  {t('shell.loading')}
                </div>
              )}
            </div>
          </main>
        )}

        {/* Right Sidebar - Panel */}
        {!hideAllSidebars && (showRight || mode === 'embedded') && (
          <aside className="w-[320px] shrink-0 border-l border-white/10 bg-white/[0.02] backdrop-blur-xl overflow-hidden">
            <RightPanelContainer
              editor={editor}
              mode={mode}
              projectId={projectId}
              onEnterPipeline={() => {
                if (projectId) { window.location.hash = `#/project/${projectId}`; }
                else { void handleCreateProject(); }
              }}
            />
          </aside>
        )}
      </div>

      {/* Status Bar */}
      {!hideAllSidebars && showToolbar && (
        <div className="flex h-8 shrink-0 items-center gap-4 border-t border-white/10 px-4 text-xs text-text-muted">
          <span>{t('status.wordCount', { count: wordCount })}</span>
          <span className="text-white/20">|</span>
          <span>
            {t('status.sceneCount', { count: derivedScenes.length })}
            {foldingEnabled && (
              <span className="ml-1 text-text-muted/60">
                ({isAllExpanded ? t('status.allExpanded') : t('status.smartFolding')})
              </span>
            )}
          </span>
          <span className="text-white/20">|</span>
          <span>
            {isOffline
              ? t('status.offlineShort')
              : isDirty
                ? t('status.unsavedDot')
                : lastSavedAt
                  ? t('status.savedAt', { time: lastSavedAt.toLocaleTimeString() })
                  : t('status.ready')}
          </span>
          <span className="text-white/20">|</span>
          <ContinuityIndicator report={continuityReport} />
          <span className="ml-auto text-text-muted/60">
            {currentFormat} / {currentRendering}
          </span>
        </div>
      )}

      {/* Shortcut Help Panel */}
      <ShortcutHelpPanel open={showShortcutHelp} onClose={closeShortcutHelp} />

      {projectId && (
        <SnapshotListDialog
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          projectId={projectId}
          onRestore={handleRestore}
        />
      )}
      {writingWorkspace && <ScriptOutlineDialog open={outlineOpen} workspace={writingWorkspace} onClose={() => setOutlineOpen(false)} onWorkspace={workspace => {
        setWritingWorkspace(workspace);
        const current = workspace.plan?.episodes.find(item => item.document_id === scriptDocumentId);
        if (current) setProjectTitle(current.title);
      }} onNavigate={navigateDocument} />}
      <ScriptWritingDialog
        open={scriptWritingOpen}
        onClose={() => setScriptWritingOpen(false)}
        onApply={handleApplyScriptDraft}
        mode={scriptWritingMode}
        projectId={projectId}
        scriptDocumentId={scriptDocumentId}
        title={projectTitle || t('document.untitled')}
        episode={selectedEpisode}
        sourceText={editor?.getText({ blockSeparator: '\n' }) || ''}
      />
      {scriptDocumentId && (
        <SnapshotListDialog
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          documentId={scriptDocumentId}
          onRestore={handleRestore}
        />
      )}
      <ImportFileDialog isOpen={seriesImportOpen} onClose={() => setSeriesImportOpen(false)}
        initialText={seriesSourceText} initialTitle={projectTitle} />
    </div>
  );
}
