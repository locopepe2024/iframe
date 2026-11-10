import { useState } from 'react';
import { playgroundApi } from '@/lib/api';
import { extractErrorDetail } from '@/lib/utils';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';

/** Persist the selected output; confirm locally even if its parent props lag. */
export function useGeneratedMaterialSave(generation: PlaygroundGeneration, output: PlaygroundGeneration['outputs'][number] | undefined) {
  const [saving, setSaving] = useState(false);
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(() => new Set());
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const key = `${generation.id}:${output?.id}`;
  const confirmed = confirmedKeys.has(key);
  const saved = !!output?.saved_to_library || confirmed;
  const save = async () => {
    if (!output || saving || saved) return;
    setSaving(true); setFailure(null);
    try {
      await playgroundApi.saveToLibrary(generation.id, output.id);
      const state = usePlaygroundStore.getState();
      const current = state.history.find(item => item.id === generation.id) || generation;
      state.updateGeneration({ ...current, outputs: current.outputs.map(item => item.id === output.id ? { ...item, saved_to_library: true } : item) });
      setConfirmedKeys(previous => new Set(previous).add(key));
    } catch (cause) {
      setFailure({ key, message: extractErrorDetail(cause, '保存到素材库失败，请重试') });
    } finally { setSaving(false); }
  };
  return { saving, saved, confirmed, error: failure?.key === key ? failure.message : '', save };
}
