'use client';

import { useCallback, useEffect, useState } from 'react';
import { scriptEditorApi, type ScriptWritingModel } from '@/lib/scriptEditorApi';

export function useScriptWritingModel() {
  const [model, setModel] = useState<ScriptWritingModel>();
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setSaved(false);
    scriptEditorApi.getWritingSettings().then(settings => {
      if (!cancelled) setModel(settings.model);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const selectModel = useCallback(async (next: ScriptWritingModel) => {
    if (saving) return;
    setSaving(true);
    setError(false);
    setSaved(false);
    try {
      const settings = await scriptEditorApi.setWritingModel(next);
      setModel(settings.model);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [saving]);

  return { model, saving, saved, error, selectModel, reload: () => setLoadAttempt(value => value + 1) };
}
