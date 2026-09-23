import { expect, it, vi } from 'vitest';
import { mergeAssetTaskResult, waitForAssetTask } from '../lib/assetTaskPolling';

it('continues beyond the old 600-poll limit and network errors until completion', async () => {
  let attempts = 0;
  const read = vi.fn(async () => {
    attempts++;
    if (attempts === 601) throw new Error('Network Error');
    return { status: attempts > 650 ? 'completed' : 'processing' };
  });
  expect(await waitForAssetTask(read, () => true, 'failed', async () => {})).toEqual({ status: 'completed' });
  expect(read).toHaveBeenCalledTimes(651);
});

it.each(['failed', 'cancelled', 'canceled'])('preserves the terminal %s reason', async status => {
  await expect(waitForAssetTask(async () => ({ status, error: 'Provider reason' }),
    () => true, 'fallback', async () => {})).rejects.toThrow('Provider reason');
});

it('stops observing on unmount without cancelling or resubmitting the task', async () => {
  let observing = true;
  const read = vi.fn();
  expect(await waitForAssetTask(read, () => observing, 'failed', async () => {
    observing = false;
  })).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it('merges only the completed target asset into the project patch', () => {
  const project: any = {
    id: 'project',
    characters: [{ id: 'character', name: 'Old name', source: 'series' }],
    scenes: [{ id: 'scene', name: 'Room' }],
    props: [],
  };
  const asset = {
    id: 'character',
    name: 'New name',
    reference_sheet: { selected_image_id: 'v1', image_variants: [{ id: 'v1', url: 'v1.png' }] },
  };

  expect(mergeAssetTaskResult(project, {
    status: 'completed',
    asset_id: 'character',
    asset_type: 'character',
    asset_source: 'episode',
    asset: { ...asset, source: 'episode' },
  })).toEqual({
    characters: [{ ...project.characters[0], ...asset, source: 'episode' }],
  });
});

it('rejects a task snapshot whose asset ID differs from the target ID', () => {
  expect(mergeAssetTaskResult({ id: 'project' } as any, {
    status: 'completed',
    asset_id: 'target',
    asset_type: 'character',
    asset: { id: 'other' },
  })).toBeNull();
});
