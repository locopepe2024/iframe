'use client';

import { useTranslations } from 'next-intl';
import type { ScriptWritingModel } from '@/lib/scriptEditorApi';

export interface ScriptModelSelectProps {
  model?: ScriptWritingModel;
  onModelChange?: (model: ScriptWritingModel) => void;
  modelBusy?: boolean;
  modelError?: boolean;
  onModelReload?: () => void;
}

export default function ScriptModelSelect({ model, onModelChange, modelBusy, modelError, onModelReload }: ScriptModelSelectProps) {
  const t = useTranslations('scriptEditor.model');
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    <label className="flex items-center gap-2 text-text-secondary">
      <span>{t('label')}</span>
      <select value={model || ''} onChange={event => onModelChange?.(event.target.value as ScriptWritingModel)}
        disabled={!model || modelBusy} title={t('hint')}
        className="min-h-10 max-w-full rounded border border-glass-border bg-surface-inset px-2 text-foreground outline-none focus:border-primary/60 disabled:opacity-50">
        {!model && <option value="">{t('loading')}</option>}
        <option value="llm-nf-all">LLM · llm-nf-all</option>
        <option value="deepseek-v4.1-flash">DeepSeek · deepseek-v4.1-flash</option>
      </select>
    </label>
    {modelError && <span role="alert" className="text-red-300">{t('failed')}
      {!model && <button type="button" onClick={onModelReload} className="ml-2 underline">{t('retry')}</button>}
    </span>}
  </div>;
}
