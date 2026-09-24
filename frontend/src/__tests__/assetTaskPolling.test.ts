import { expect, it, vi } from 'vitest';
import {
  createSingleFlightTaskStatusPoller,
  mergeAssetTaskResult,
  normalizeTaskFailureDetail,
  waitForAssetTask,
} from '../lib/assetTaskPolling';

it('coalesces overlapping status reads and handles a terminal failure only once', async () => {
  let resolveStatus!: (status: { status: string; error: string }) => void;
  const pendingStatus = new Promise<{ status: string; error: string }>((resolve) => {
    resolveStatus = resolve;
  });
  const read = vi.fn(() => pendingStatus);
  const onStatus = vi.fn();
  const poll = createSingleFlightTaskStatusPoller(
    read,
    (status) => status.status === 'completed' || status.status === 'failed',
    onStatus,
  );

  const first = poll();
  const overlapping = poll();
  expect(overlapping).toBe(first);
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1);

  const failed = { status: 'failed', error: 'blocked' };
  resolveStatus(failed);
  await first;
  await poll();

  expect(onStatus).toHaveBeenCalledTimes(1);
  expect(onStatus).toHaveBeenCalledWith(failed);
  expect(read).toHaveBeenCalledTimes(1);
});

it('allows another status read after a transient polling error', async () => {
  const read = vi.fn()
    .mockRejectedValueOnce(new Error('Network error'))
    .mockResolvedValueOnce({ status: 'processing' });
  const onStatus = vi.fn();
  const poll = createSingleFlightTaskStatusPoller(
    read,
    (status: { status: string }) => status.status === 'completed' || status.status === 'failed',
    onStatus,
  );

  await expect(poll()).rejects.toThrow('Network error');
  await poll();

  expect(read).toHaveBeenCalledTimes(2);
  expect(onStatus).toHaveBeenCalledWith({ status: 'processing' });
});

it('strips repeated backend generation wrappers from failure details', () => {
  expect(normalizeTaskFailureDetail('生成失败：生成失败：UniArt task failed')).toBe('UniArt task failed');
  expect(normalizeTaskFailureDetail('Provider rejected the prompt')).toBe('Provider rejected the prompt');
  expect(normalizeTaskFailureDetail(undefined)).toBe('');
});

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
    script_id: 'project',
    asset_id: 'character',
    asset_type: 'character',
    asset_source: 'episode',
    asset: { ...asset, source: 'episode' },
  })).toEqual({
    characters: [{ ...project.characters[0], ...asset, source: 'episode' }],
  });
});

it('rejects a task snapshot whose asset or project ID differs from the target', () => {
  expect(mergeAssetTaskResult({ id: 'project' } as any, {
    status: 'completed',
    script_id: 'project',
    asset_id: 'target',
    asset_type: 'character',
    asset: { id: 'other' },
  })).toBeNull();
  expect(mergeAssetTaskResult({ id: 'project' } as any, {
    status: 'completed',
    script_id: 'other-project',
    asset_id: 'target',
    asset_type: 'character',
    asset: { id: 'target' },
  })).toBeNull();
});
