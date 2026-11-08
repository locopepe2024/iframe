import { useEffect, useRef, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { scriptEditorApi, type SaveDocumentResponse } from '@/lib/scriptEditorApi';
import { useEditorStore } from '@/store/editorStore';

const AUTOSAVE_INTERVAL_MS = 30_000; // 30 seconds

/**
 * 自动保存 Hook
 * - 30s 周期自动保存（仅当 isDirty 时）
 * - Cmd+S / Ctrl+S 手动保存 + 创建快照
 * - beforeunload 事件拦截（离开页面前提醒保存）
 */
export function useAutoSave(editor: Editor | null, projectId: string | null, documentId?: string, title?: string) {
  const { setDirty, setLastSavedAt } = useEditorStore();
  const pendingSaveRef = useRef<Promise<SaveDocumentResponse | null>>(Promise.resolve(null));
  const mountedRef = useRef(true);
  const latestTitleRef = useRef(title);
  latestTitleRef.current = title;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 核心保存逻辑
  const save = useCallback(
    (createSnapshot = false): Promise<SaveDocumentResponse | null> => {
      const operation = pendingSaveRef.current.then(async () => {
        if (!editor || editor.isDestroyed || (!projectId && !documentId)) return null;
        const content = editor.getJSON();

        try {
          const result = documentId
            ? await scriptEditorApi.saveScriptDocument(documentId, content, title, createSnapshot)
            : await scriptEditorApi.saveDocument(projectId!, content, createSnapshot);
          // Edits made while the request was in flight still need another save.
          if (mountedRef.current && !editor.isDestroyed) {
            if (latestTitleRef.current === title && JSON.stringify(editor.getJSON()) === JSON.stringify(content)) setDirty(false);
            setLastSavedAt(new Date());
          }
          return result;
        } catch (err) {
          console.error('[useAutoSave] Save failed:', err);
          return null;
        }
      });
      pendingSaveRef.current = operation;
      return operation;
    },
    [editor, projectId, documentId, title, setDirty, setLastSavedAt]
  );

  // 30s 周期自动保存
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (useEditorStore.getState().isDirty) {
        save(false);
      }
    }, AUTOSAVE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [save]);

  // Cmd+S / Ctrl+S 手动保存（创建快照）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save(true); // 手动保存时创建快照
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [save]);

  // beforeunload 拦截
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return { save };
}
