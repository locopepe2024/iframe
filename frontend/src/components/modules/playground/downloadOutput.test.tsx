import { afterEach, expect, it, vi } from 'vitest';
import { downloadOutput } from './downloadOutput';
import { authenticatedFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ API_URL: 'https://garage.uniart.fun', authenticatedFetch: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.useRealTimers(); });

it.each([['image', 'image/png', 'png'], ['video', 'video/mp4', 'mp4']])('downloads authenticated %s with a usable filename', async (kind, mime, extension) => {
  vi.useFakeTimers();
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(new Blob(['media'], { type: mime })));
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  let filename = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  await downloadOutput('generation', 'output', kind);
  expect(authenticatedFetch).toHaveBeenCalledWith('https://garage.uniart.fun/playground/media/generation/output');
  expect(create).toHaveBeenCalledOnce();
  expect(filename).toBe(`generation-output.${extension}`);
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60000);
  expect(revoke).toHaveBeenCalledWith('blob:download');
});

it('reports expired authorization instead of downloading an error body', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response('unauthorized', { status: 401 }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  await expect(downloadOutput('g', 'o', 'image')).rejects.toThrow('HTTP 401');
  expect(click).not.toHaveBeenCalled();
});
