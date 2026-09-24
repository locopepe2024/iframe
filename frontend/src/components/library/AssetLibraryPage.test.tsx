import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AssetLibraryPage from './AssetLibraryPage';
const mocked = vi.hoisted(() => ({
  getAssetLibraryIndex: vi.fn(), getProject: vi.fn(), deleteLibraryAsset: vi.fn(), error: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mocked }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: { name?: string }) => values?.name ? `${key} ${values.name}` : key }));
vi.mock('@/store/toastStore', () => ({ toast: { error: mocked.error } }));
vi.mock('./RecreationMediaLibrary', () => ({ default: () => <div>recreation media browser</div> }));
vi.mock('./AssetInspector', () => ({ default: ({ asset, onAssetUpdated }: any) => <div>
  <span>inspector</span>
  <output data-testid="asset-task-state">{`${asset.status || ''}:${asset.generation_task?.status || ''}:${asset.generation_task?.error || ''}`}</output>
  <button type="button" onClick={() => onAssetUpdated?.({
    id: 'character-1', name: 'Test character', description: '',
    reference_sheet: { image_variants: [{ id: 'cover-v2', url: 'new-cover.png' }], selected_image_id: 'cover-v2' },
  })}>apply generated snapshot</button>
  <button type="button" onClick={() => onAssetUpdated?.({
    id: 'character-1', name: 'Test character', description: '',
    reference_sheet: {
      image_variants: [{ id: 'cover-v1', url: 'cover.png' }, { id: 'candidate-v2', url: 'candidate.png' }],
      selected_image_id: 'cover-v1',
    },
  })}>add generated candidate</button>
</div> }));
vi.mock('./NewLibraryAssetDialog', () => ({ default: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
  mocked.getProject.mockResolvedValue({ characters: [], scenes: [], props: [] });
  mocked.getAssetLibraryIndex.mockResolvedValue({
    schema_version: 1,
    project_id: 'library',
    assets: [{ asset_type: 'character', asset_id: 'character-1', name: 'Test character', source_scope: 'global', selected_variant_id: 'cover-v1', variants: [{ id: 'cover-v1', url: 'cover.png' }] }],
  });
});
it('deletes a library character without selecting its card', async () => {
  mocked.deleteLibraryAsset.mockResolvedValue({ status: 'deleted' });
  mocked.getAssetLibraryIndex
    .mockResolvedValueOnce({ schema_version: 1, project_id: 'library', assets: [{ asset_type: 'character', asset_id: 'character-1', name: 'Test character', source_scope: 'global', variants: [] }] });
  render(<AssetLibraryPage />);
  const button = await screen.findByRole('button', { name: 'deleteNamed Test character' });
  fireEvent.click(button);
  await waitFor(() => expect(mocked.deleteLibraryAsset).toHaveBeenCalledWith('character', 'character-1'));
  await waitFor(() => expect(screen.queryByText('Test character')).not.toBeInTheDocument());
  expect(screen.queryByText('inspector')).not.toBeInTheDocument();
  expect(mocked.getAssetLibraryIndex).toHaveBeenCalledTimes(1);
});
it('retains referenced assets and explains the deletion conflict', async () => {
  mocked.deleteLibraryAsset.mockRejectedValue({ response: { status: 409 } });
  render(<AssetLibraryPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'deleteNamed Test character' }));
  await waitFor(() => expect(mocked.error).toHaveBeenCalledWith('deleteInUse'));
  expect(screen.getByText('Test character')).toBeInTheDocument();
});

it('updates a generated card from its returned asset snapshot without refetching the full library', async () => {
  render(<AssetLibraryPage />);
  fireEvent.click(await screen.findByText('Test character'));
  fireEvent.click(screen.getByRole('button', { name: 'apply generated snapshot' }));

  await waitFor(() => expect(screen.getByRole('img', { name: 'Test character' })).toHaveAttribute('src', 'new-cover.png'));
  expect(mocked.getAssetLibraryIndex).toHaveBeenCalledTimes(1);
});

it('keeps the chosen library cover when generation adds an unselected candidate', async () => {
  render(<AssetLibraryPage />);
  fireEvent.click(await screen.findByText('Test character'));
  fireEvent.click(screen.getByRole('button', { name: 'add generated candidate' }));

  await waitFor(() => expect(screen.getByRole('img', { name: 'Test character' })).toHaveAttribute('src', 'cover.png'));
  expect(mocked.getAssetLibraryIndex).toHaveBeenCalledTimes(1);
});

it('loads durable failure state only when opening a project asset detail', async () => {
  mocked.getAssetLibraryIndex.mockResolvedValue({
    schema_version: 1,
    project_id: 'library',
    assets: [{ asset_type: 'character', asset_id: 'character-1', name: 'Test character', source_scope: 'episode', source_container_id: 'project-1', source_name: 'Episode 1', variants: [] }],
  });
  mocked.getProject.mockResolvedValue({
    characters: [{ id: 'character-1', status: 'failed', generation_task: { status: 'failed', error: 'UniArt timed out' } }],
    scenes: [], props: [],
  });
  render(<AssetLibraryPage />);
  fireEvent.click(await screen.findByText('Test character'));

  await waitFor(() => expect(screen.getByTestId('asset-task-state')).toHaveTextContent('failed:failed:UniArt timed out'));
  expect(mocked.getProject).toHaveBeenCalledWith('project-1');
  expect(mocked.getAssetLibraryIndex).toHaveBeenCalledTimes(1);
});

it('opens recreation media from the library and returns to semantic assets', async () => {
  render(<AssetLibraryPage />);
  await screen.findByText('Test character');
  fireEvent.click(screen.getByRole('button', { name: 'media' }));
  expect(screen.getByText('recreation media browser')).toBeInTheDocument();
  expect(screen.getByText('Test character').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'assets' }));
  expect(await screen.findByText('Test character')).toBeInTheDocument();
  expect(screen.getByText('Test character').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'false');
  expect(mocked.getAssetLibraryIndex).toHaveBeenCalledTimes(1);
});
