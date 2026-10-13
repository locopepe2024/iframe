import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssetIndexPreview } from './AssetIndexPreview';

const mocks = vi.hoisted(() => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ API_URL: '/api', authenticatedFetch: mocks.authenticatedFetch }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:asset-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  mocks.authenticatedFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['image']) });
});

it('loads an episode variant through the authenticated project preview', async () => {
  const { unmount } = render(<AssetIndexPreview asset={{ source_scope: 'episode', source_container_id: 'project-1',
    asset_type: 'character', asset_id: 'character-1', variant_id: 'variant-1' }} alt="Actor" />);
  expect(await screen.findByRole('img', { name: 'Actor' })).toHaveAttribute('src', 'blob:asset-preview');
  expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
    expect.stringContaining('/asset-index/preview?scope=project&container_id=project-1&asset_type=character&asset_id=character-1&variant_id=variant-1'),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  unmount();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:asset-preview'));
});

it('uses the global preview scope for shared library assets', async () => {
  render(<AssetIndexPreview asset={{ source_scope: 'global', source_container_id: null,
    asset_type: 'scene', asset_id: 'scene-1', variant_id: 'variant-2' }} alt="Shared scene" />);
  await screen.findByRole('img', { name: 'Shared scene' });
  expect(mocks.authenticatedFetch.mock.calls[0][0]).toContain('scope=global&container_id=&asset_type=scene');
});
