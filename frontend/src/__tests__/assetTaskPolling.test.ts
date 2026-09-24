import { expect, it, vi } from 'vitest';
import { AssetTaskFailure, getAssetIndexState, mergeAssetTaskResult, waitForAssetTask } from '../lib/assetTaskPolling';

it('stops observation at the task deadline after processing and transport errors', async () => {
  let now = 1_000;
  const read = vi.fn()
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValue({ status: 'processing' });
  const pause = async () => { now += 1_000; };

  await expect(waitForAssetTask(
    read,
    () => true,
    'failed',
    pause,
    { timeoutMs: 3_000, startedAt: 1_000, now: () => now },
  )).resolves.toMatchObject({ status: 'timed_out' });
  expect(read).toHaveBeenCalledTimes(2);
});

it('bounds a task status request that never resolves', async () => {
  vi.useFakeTimers();
  const read = vi.fn(() => new Promise<any>(() => {}));
  const pending = waitForAssetTask(read, () => true, 'failed', async () => {}, { timeoutMs: 3_000 });

  await vi.advanceTimersByTimeAsync(3_000);

  await expect(pending).resolves.toMatchObject({ status: 'timed_out' });
  expect(read).toHaveBeenCalledOnce();
  vi.useRealTimers();
});

it('checks the server once for an aged local marker before reporting a timeout', async () => {
  const completed = { status: 'completed', asset_id: 'character' };
  const read = vi.fn().mockResolvedValue(completed);

  await expect(waitForAssetTask(
    read,
    () => true,
    'failed',
    async () => {},
    { timeoutMs: 1, startedAt: 0, now: () => 10 },
  )).resolves.toEqual(completed);
  expect(read).toHaveBeenCalledOnce();
});

it.each(['failed', 'cancelled', 'canceled'])('preserves the terminal %s reason', async status => {
  await expect(waitForAssetTask(async () => ({ status, error: 'Provider reason' }),
    () => true, 'fallback', async () => {})).rejects.toThrow('Provider reason');
});

it('keeps the failed task snapshot available so partial variants can be merged', async () => {
  const failed = {
    status: 'failed',
    error: 'Provider timed out',
    asset_id: 'character',
    asset_type: 'character' as const,
    asset: { id: 'character', status: 'failed', reference_sheet: { image_variants: [{ id: 'partial', url: 'partial.png' }] } },
    asset_index_state: 'empty' as const,
  };
  await expect(waitForAssetTask(async () => failed, () => true, 'fallback', async () => {}))
    .rejects.toMatchObject({ task: failed, message: 'Provider timed out' });
  expect(mergeAssetTaskResult({ id: 'project', characters: [{ id: 'character', name: 'A' }] } as any, failed))
    .toEqual({ characters: [{ name: 'A', ...failed.asset }] });
});

it('stops polling when the server confirms a task ID no longer exists', async () => {
  const read = vi.fn().mockRejectedValue({ response: { status: 404 } });
  await expect(waitForAssetTask(read, () => true, 'fallback', async () => {}))
    .resolves.toMatchObject({ status: 'missing' });
  expect(read).toHaveBeenCalledOnce();
});

it('distinguishes stale image selection indexes from an empty selection', () => {
  expect(getAssetIndexState({ image_asset: { selected_id: 'gone', variants: [] } }, 'scene')).toBe('stale');
  expect(getAssetIndexState({ image_asset: { selected_id: 'kept', variants: [{ id: 'kept', url: 'kept.png' }] } }, 'scene')).toBe('valid');
  expect(getAssetIndexState({ image_asset: { selected_id: null, variants: [] } }, 'scene')).toBe('empty');
  expect(getAssetIndexState({ image_url: 'legacy.png' }, 'scene')).toBe('legacy');
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
