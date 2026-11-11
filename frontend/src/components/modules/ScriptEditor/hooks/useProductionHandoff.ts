import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/store/toastStore';

interface ProductionHandoffOptions {
  editor: Editor | null;
  projectId?: string;
  scriptDocumentId?: string;
  title: string;
  canEnter: boolean;
  save: (createSnapshot?: boolean) => Promise<unknown>;
}

export function useProductionHandoff({
  editor, projectId, scriptDocumentId, title, canEnter, save,
}: ProductionHandoffOptions) {
  const t = useTranslations('scriptEditor');
  const [isEntering, setIsEntering] = useState(false);
  const enteringRef = useRef(false);
  const [association, setAssociation] = useState<{ documentId: string; projectId: string | null } | null>(null);
  const [checkingDocumentId, setCheckingDocumentId] = useState<string | null>(scriptDocumentId ?? null);
  const targetProjectId = projectId || (association?.documentId === scriptDocumentId ? association?.projectId : null);
  const isChecking = Boolean(scriptDocumentId && checkingDocumentId === scriptDocumentId);

  useEffect(() => {
    if (projectId || !scriptDocumentId) return;
    let cancelled = false;
    setCheckingDocumentId(scriptDocumentId);
    api.getScriptDocumentProject(scriptDocumentId)
      .then(({ project_id }) => {
        if (!cancelled) setAssociation({ documentId: scriptDocumentId, projectId: project_id });
      })
      // A failed lookup is retried on click; it must never imply creation.
      .catch(() => {})
      .finally(() => { if (!cancelled) setCheckingDocumentId(null); });
    return () => { cancelled = true; };
  }, [projectId, scriptDocumentId]);

  const enterProduction = useCallback(async () => {
    if (!editor || editor.isDestroyed || !canEnter || enteringRef.current || (!projectId && !scriptDocumentId)) return;
    enteringRef.current = true;
    setIsEntering(true);
    try {
      let targetProjectId = projectId;
      let targetSeriesId: string | undefined;
      if (!targetProjectId && scriptDocumentId) {
        targetProjectId = (await api.getScriptDocumentProject(scriptDocumentId)).project_id ?? undefined;
      }
      const text = editor.getText({ blockSeparator: '\n' });
      if (!targetProjectId && !text.trim()) return;
      if (!await save(false)) throw new Error(t('toolbar.saveFailed'));
      // Authoring handoff is idempotent and also repairs the root-series link
      // for projects created before series-aware handoff was available.
      if (!projectId && scriptDocumentId) {
        const project = await api.createProject(
          title.trim() || t('document.untitled'), text, true, 'r2v', undefined, scriptDocumentId,
        );
        targetProjectId = project.id;
        targetSeriesId = project.series_id;
      }
      if (scriptDocumentId) setAssociation({ documentId: scriptDocumentId, projectId: targetProjectId! });
      window.location.hash = targetSeriesId
        ? `#/series/${targetSeriesId}/episode/${targetProjectId}`
        : `#/project/${targetProjectId}`;
    } catch (cause) {
      toast.error(t('panels.productionFailed'), {
        body: cause instanceof Error ? cause.message : t('toolbar.saveFailedHint'),
      });
    } finally {
      enteringRef.current = false;
      setIsEntering(false);
    }
  }, [editor, canEnter, projectId, scriptDocumentId, title, save, t]);

  return { isEntering, isChecking, targetProjectId, enterProduction };
}
