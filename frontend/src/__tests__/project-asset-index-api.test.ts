import axios from 'axios';
import { expect, it, vi } from 'vitest';
vi.mock('axios', () => ({ default: { get: vi.fn(), interceptors: { request: { use: vi.fn() } } } }));
import { api, API_URL } from '@/lib/api';
it('requests project membership explicitly while retaining the workbench candidate API', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { assets: [] } });
    await api.getProjectAssetReferenceIndex('project-a');
    expect(axios.get).toHaveBeenLastCalledWith(`${API_URL}/projects/project-a/asset-index`, {
        params: { scope: 'project' }, headers: { 'Cache-Control': 'no-cache' },
    });
    await api.getAssetReferenceIndex('project-a');
    expect(axios.get).toHaveBeenLastCalledWith(`${API_URL}/projects/project-a/asset-index`, {
        headers: { 'Cache-Control': 'no-cache' },
    });
});
