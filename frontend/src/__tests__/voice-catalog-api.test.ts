import { afterEach, expect, it, vi } from 'vitest';
vi.mock('axios', () => ({ default: { interceptors: { request: { use: vi.fn() } } } }));
import { api } from '@/lib/api';

afterEach(() => vi.unstubAllGlobals());

it('surfaces the actionable voice catalog response instead of a generic fetch error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '请先配置 UniArt 网关' }), { status: 409 })));
  await expect(api.getVoices()).rejects.toThrow('请先配置 UniArt 网关');
});

it('reports the HTTP status when the server returns a non-JSON error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })));
  await expect(api.getVoices()).rejects.toThrow('HTTP 502');
});
