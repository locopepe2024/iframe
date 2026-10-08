import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AssetLibraryPage from './AssetLibraryPage';
const mocked = vi.hoisted(() => ({
  getAssetLibraryIndex: vi.fn(), deleteLibraryAsset: vi.fn(), authenticatedFetch: vi.fn(), error: vi.fn(),
  updateLibraryAsset: vi.fn(), updateSeriesAssetAttributes: vi.fn(), updateAssetAttributes: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mocked, API_URL: '', authenticatedFetch: mocked.authenticatedFetch }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: { name?: string }) => values?.name ? `${key} ${values.name}` : key }));
vi.mock('@/store/toastStore', () => ({ toast: { error: mocked.error } }));
vi.mock('./RecreationMediaLibrary', () => ({ default: () => <div>recreation media browser</div> }));
vi.mock('./AssetInspector', () => ({ default: ({ onCoverUpdated, onRename }: { onCoverUpdated: (result: any) => void; onRename: (name: string) => Promise<void> }) => (<>
  <button type="button" onClick={() => onCoverUpdated({
    asset_type: 'character', asset_id: 'character-1', cover_variant_id: 'candidate-2',
    variant: { id: 'candidate-2', url: 'assets/candidate.png' },
  })}>apply cover selection</button>
  <button type="button" onClick={() => void onRename('Renamed character')}>rename selected asset</button>
</>) }));
vi.mock('./NewLibraryAssetDialog', () => ({ default: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IntersectionObserver', undefined);
  mocked.authenticatedFetch.mockRejectedValue(new Error('preview unavailable'));
  mocked.updateLibraryAsset.mockResolvedValue({});
  mocked.updateSeriesAssetAttributes.mockResolvedValue({});
  mocked.updateAssetAttributes.mockResolvedValue({});
  mocked.getAssetLibraryIndex.mockResolvedValue({ schema_version: 1, project_id: 'library', assets: [{ asset_type: 'character', asset_id: 'character-1', name: 'Test character', source_scope: 'global', source_container_id: null, selected_variant_id: null, cover_variant_id: null, variants: [] }] });
});

it.each([
  ['global', null, 'updateLibraryAsset'],
  ['series', 'series-1', 'updateSeriesAssetAttributes'],
  ['project', 'project-1', 'updateAssetAttributes'],
] as const)('renames an asset in its %s owner', async (sourceScope, sourceId, method) => {
  const entry = {
    asset_type: 'character', asset_id: 'character-1', name: 'Test character',
    source_scope: sourceScope, source_container_id: sourceId, variants: [],
  };
  mocked.getAssetLibraryIndex
    .mockResolvedValueOnce({ schema_version: 1, project_id: 'library', assets: [entry] })
    .mockResolvedValue({ schema_version: 1, project_id: 'library', assets: [{ ...entry, name: 'Renamed character' }] });
  render(<AssetLibraryPage />);
  fireEvent.click(await screen.findByText('Test character'));
  fireEvent.click(screen.getByRole('button', { name: 'rename selected asset' }));
  await waitFor(() => expect(mocked[method]).toHaveBeenCalledWith(
    ...(sourceScope === 'global'
      ? ['character', 'character-1', { name: 'Renamed character' }]
      : [sourceId, 'character-1', 'character', { name: 'Renamed character' }]),
  ));
  expect(await screen.findByText('Renamed character')).toBeInTheDocument();
});
it('deletes a library character without selecting its card', async () => {
  mocked.deleteLibraryAsset.mockResolvedValue({ status: 'deleted' });
  render(<AssetLibraryPage />);
  const button = await screen.findByRole('button', { name: 'deleteNamed Test character' });
  mocked.getAssetLibraryIndex.mockResolvedValue({ schema_version: 1, project_id: 'library', assets: [] });
  fireEvent.click(button);
  await waitFor(() => expect(mocked.deleteLibraryAsset).toHaveBeenCalledWith('character', 'character-1'));
  await waitFor(() => expect(screen.queryByText('Test character')).not.toBeInTheDocument());
  expect(screen.queryByText('inspector')).not.toBeInTheDocument();
});
it('retains referenced assets and explains the deletion conflict', async () => {
  mocked.deleteLibraryAsset.mockRejectedValue({ response: { status: 409 } });
  render(<AssetLibraryPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'deleteNamed Test character' }));
  await waitFor(() => expect(mocked.error).toHaveBeenCalledWith('deleteInUse'));
  expect(screen.getByText('Test character')).toBeInTheDocument();
});

it('requests an owner-scoped preview for a local variant path', async () => {
  mocked.getAssetLibraryIndex.mockResolvedValue({
    schema_version: 1,
    project_id: 'library',
    assets: [{
      asset_type: 'scene',
      asset_id: 'night-train',
      name: '夜间火车车厢',
      source_scope: 'series',
      source_container_id: 'series-1',
      source_name: '投稿系列',
      selected_variant_id: 'variant-1',
      variants: [{ id: 'variant-1', url: 'assets/scenes/night-train.png' }],
    }],
  });
  render(<AssetLibraryPage />);
  await screen.findByText('夜间火车车厢');
  await waitFor(() => expect(mocked.authenticatedFetch).toHaveBeenCalledWith(
    expect.stringContaining('scope=series&container_id=series-1&asset_type=scene&asset_id=night-train&variant_id=variant-1'),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  ));
  expect(screen.queryByRole('img', { name: '夜间火车车厢' })).not.toBeInTheDocument();
});

it('opens recreation media from the library and returns to semantic assets', async () => {
  render(<AssetLibraryPage />);
  await screen.findByText('Test character');
  fireEvent.click(screen.getByRole('button', { name: 'media' }));
  expect(screen.getByText('recreation media browser')).toBeInTheDocument();
  expect(screen.queryByText('Test character')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'assets' }));
  expect(await screen.findByText('Test character')).toBeInTheDocument();
});

it('patches a cover from the mutation response without reloading the library index', async () => {
  mocked.getAssetLibraryIndex.mockResolvedValue({
    schema_version: 1,
    project_id: 'library',
    assets: [{
      asset_type: 'character',
      asset_id: 'character-1',
      name: 'Test character',
      source_scope: 'project',
      source_container_id: 'project-1',
      selected_variant_id: 'candidate-2',
      cover_variant_id: 'cover-1',
      variants: [
        { id: 'cover-1', url: 'assets/cover.png' },
        { id: 'candidate-2', url: 'assets/candidate.png' },
      ],
    }],
  });
  render(<AssetLibraryPage />);
  await screen.findByText('Test character');
  await waitFor(() => expect(mocked.authenticatedFetch).toHaveBeenCalledWith(
    expect.stringContaining('variant_id=cover-1'), expect.any(Object),
  ));
  fireEvent.click(screen.getByText('Test character'));
  fireEvent.click(await screen.findByRole('button', { name: 'apply cover selection' }));
  await waitFor(() => expect(mocked.authenticatedFetch).toHaveBeenCalledWith(
    expect.stringContaining('variant_id=candidate-2'), expect.any(Object),
  ));
  expect(mocked.getAssetLibraryIndex).toHaveBeenCalledTimes(1);
  expect(mocked.getAssetLibraryIndex).toHaveBeenCalledTimes(1);
});

it('loads a cover preview using the authenticated asset reference', async () => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover-preview');
  mocked.authenticatedFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['webp'], { type: 'image/webp' }) });
  mocked.getAssetLibraryIndex.mockResolvedValue({ schema_version: 1, project_id: 'library', assets: [{
    asset_type: 'scene', asset_id: 'room', name: 'Room', source_scope: 'global',
    source_container_id: null, selected_variant_id: 'v1', variants: [{ id: 'v1', url: 'assets/room.png' }],
  }] });
  try {
    render(<AssetLibraryPage />);
    expect(await screen.findByRole('img', { name: 'Room' })).toHaveAttribute('src', 'blob:cover-preview');
    expect(mocked.authenticatedFetch).toHaveBeenCalledWith(
      expect.stringContaining('/asset-index/preview?scope=global'), expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  } finally { createObjectURL.mockRestore(); }
});
