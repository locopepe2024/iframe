import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { editing } from '@/lib/editing';
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('@/lib/api', () => ({ API_URL: '' }));
beforeEach(() => vi.clearAllMocks());
it('rejects an HTTP 200 SPA document before projects.map', async () => {
  vi.mocked(axios.get).mockResolvedValue({ data: '<!DOCTYPE html><html>SPA</html>' });
  await expect(editing.list()).rejects.toThrow('Invalid editing API response');
  await expect(editing.folders()).rejects.toThrow('Invalid editing API response');
  await expect(editing.materials()).rejects.toThrow('Invalid editing API response');
});
it('rejects malformed plans and pagination before state changes', async () => {
  vi.mocked(axios.get).mockResolvedValue({ data: [{ id: 'p', title: 'p', revision: 1, sources: {}, plan: { lanes: {} } }] });
  await expect(editing.list()).rejects.toThrow('Invalid editing API response');
  vi.mocked(axios.get).mockResolvedValue({ data: { items: {}, next_cursor: null } });
  await expect(editing.materials()).rejects.toThrow('Invalid editing API response');
});
it('preserves valid JSON projects and material pages', async () => {
  const projects = [{ id: 'p', title: 'p', revision: 1, sources: {}, plan: null, output: null }];
  vi.mocked(axios.get).mockResolvedValue({ data: projects });
  expect(await editing.list()).toEqual(projects);
  vi.mocked(axios.get).mockResolvedValue({ data: { items: [{ id: 'm', name: 'clip.mp4' }], next_cursor: null } });
  expect((await editing.materials()).items).toHaveLength(1);
});
