'use client';

import { ArrowRight, FileText, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEditorStore } from '@/store/editorStore';

export interface PipelinePanelProps {
  projectId?: string;
  onEnterPipeline?: () => void;
  disabled?: boolean;
  isEntering?: boolean;
}

export default function PipelinePanel({ projectId, onEnterPipeline, disabled = false, isEntering = false }: PipelinePanelProps) {
  const t = useTranslations('scriptEditor');
  const wordCount = useEditorStore((s) => s.wordCount);
  const editorMode = useEditorStore((s) => s.editorMode);
  const isEmbedded = editorMode === 'embedded';

  return (
    <div className="space-y-5 p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">{t('panels.productionTitle')}</h3>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          {t(projectId ? 'panels.productionExistingHint' : 'panels.productionNewHint')}
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-3 py-3 text-sm">
        <FileText size={16} aria-hidden="true" className="shrink-0 text-text-muted" />
        <span className="text-text-secondary">{t('panels.productionBodyCount', { count: wordCount })}</span>
      </div>

      {!isEmbedded && (
        <div className="space-y-2">
          <button type="button" onClick={onEnterPipeline}
            disabled={disabled || isEntering || (!projectId && wordCount === 0) || !onEnterPipeline}
            aria-busy={isEntering}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50">
            {isEntering && <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {t(isEntering ? 'panels.productionEntering' : projectId ? 'panels.enterPipeline' : 'panels.productionCreate')}
            {!isEntering && <ArrowRight size={16} aria-hidden="true" />}
          </button>
          <p className="text-xs leading-5 text-text-secondary">
            {t(!projectId && wordCount === 0 ? 'panels.productionEmpty' : 'panels.productionEntryHint')}
          </p>
        </div>
      )}
    </div>
  );
}
