'use client';

import { useCallback, useEffect, useState } from 'react';
import { scriptEditorApi, type ScriptWritingModel } from '@/lib/scriptEditorApi';

export function useScriptWritingModel() {
  const [model, setModel] = useState<ScriptWritingModel>();
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    scriptEditorApi.getWritingSettings().then(settings => {
      if (!cancelled) setModel(settings.model);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const selectModel = useCallback(async (next: ScriptWritingModel) => {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      const settings = await scriptEditorApi.setWritingModel(next);
      setModel(settings.model);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [saving]);

  return { model, saving, error, selectModel, reload: () => setLoadAttempt(value => value + 1) };
}
