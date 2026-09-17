import { expect, it, vi } from 'vitest';
import { waitForAssetTask } from '../lib/assetTaskPolling';

it('continues beyond the old 600-poll limit and network errors until completion', async () => {
  let attempts = 0;
  const read = vi.fn(async () => {
    attempts++;
    if (attempts === 601) throw new Error('Network Error');
    return { status: attempts > 650 ? 'completed' : 'processing' };
  });
  expect(await waitForAssetTask(read, () => true, 'failed', async () => {})).toBe(true);
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
  })).toBe(false);
  expect(read).not.toHaveBeenCalled();
});
