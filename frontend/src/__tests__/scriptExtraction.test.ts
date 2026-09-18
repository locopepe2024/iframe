import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { extractScriptPreview, refineScriptPreview } from '../lib/scriptExtraction';
vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn(), isAxiosError: (e: any) => e?.isAxiosError === true } }));
const result = { characters: [], scenes: [], props: [] };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());
it('recovers polling failures without submitting another extraction', async () => {
  vi.mocked(axios.post).mockResolvedValue({ data: { id: 'job', status: 'running' } });
  vi.mocked(axios.get).mockRejectedValueOnce({ isAxiosError: true }).mockResolvedValueOnce({ data: { id: 'job', status: 'completed', result } });
  const pending = extractScriptPreview('/api', 'project', 'text');
  await vi.runAllTimersAsync();
  expect(await pending).toEqual(result);
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.get).toHaveBeenCalledTimes(2);
});
it('reuses a completed task immediately after refresh/retry', async () => {
  vi.mocked(axios.post).mockResolvedValue({ data: { id: 'job', status: 'completed', result } });
  expect(await extractScriptPreview('/api', 'project', 'text')).toEqual(result);
  expect(axios.get).not.toHaveBeenCalled();
});
it('reports failed jobs without rerunning the provider', async () => {
  vi.mocked(axios.post).mockResolvedValue({ data: { id: 'job', status: 'failed', error: 'Analysis interrupted' } });
  await expect(extractScriptPreview('/api', 'project', 'text')).rejects.toThrow('Analysis interrupted');
  expect(axios.get).not.toHaveBeenCalled();
});
it('submits refinement context and polls the canonical job endpoint', async () => {
  vi.mocked(axios.post).mockResolvedValue({ data: { id: 'refine-job', status: 'running' } });
  vi.mocked(axios.get).mockResolvedValue({ data: { id: 'refine-job', status: 'completed', result } });
  const draft = { characters: [{ name: 'Host' }], scenes: [], props: [] };
  const pending = refineScriptPreview('/api', 'project', 'text', draft, ['Exclude extras']);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual(result);
  expect(axios.post).toHaveBeenCalledWith(
    '/api/projects/project/extraction-jobs/refine',
    { text: 'text', draft, instructions: ['Exclude extras'] },
    { timeout: 15000 },
  );
  expect(axios.get).toHaveBeenCalledWith(
    '/api/projects/project/extraction-jobs/refine-job',
    { timeout: 15000 },
  );
});
