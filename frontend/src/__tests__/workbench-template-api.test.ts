import axios from 'axios';
import { expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(), interceptors: { request: { use: vi.fn() } } } }));
import { api } from '@/lib/api';

it('rejects the SPA fallback instead of treating HTML as a template catalog', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: '<!doctype html><html></html>' });
    await expect(api.getWorkbenchTemplates()).rejects.toThrow('Workbench template catalog is unavailable');

    const catalog = { schema_version: 1, catalog_revision: 'test', templates: [] };
    vi.mocked(axios.get).mockResolvedValueOnce({ data: catalog });
    await expect(api.getWorkbenchTemplates()).resolves.toEqual(catalog);
});
