'use client';

import { useTranslations } from 'next-intl';
import ScriptModelSelect from './ScriptModelSelect';
import { useScriptWritingModel } from './useScriptWritingModel';

/** All settings surfaces edit the same owner-scoped screenplay model. */
export default function ScreenplayModelSettings() {
  const t = useTranslations('scriptEditor.model');
  const settings = useScriptWritingModel();
  return <div className="space-y-2">
    <ScriptModelSelect model={settings.model} modelBusy={settings.saving} modelError={settings.error}
      onModelChange={model => { void settings.selectModel(model); }} onModelReload={settings.reload} />
    <p className="text-xs text-text-muted">{t('hint')}</p>
    <p role="status" aria-live="polite" className="text-xs text-text-secondary">
      {settings.saving ? t('saving') : settings.saved ? t('saved') : t('scope')}
    </p>
  </div>;
}
