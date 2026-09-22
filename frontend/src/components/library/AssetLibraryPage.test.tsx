import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AssetLibraryPage from './AssetLibraryPage';
const mocked = vi.hoisted(() => ({
  getAssetLibraryIndex: vi.fn(), deleteLibraryAsset: vi.fn(), error: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mocked }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: { name?: string }) => values?.name ? `${key} ${values.name}` : key }));
vi.mock('@/store/toastStore', () => ({ toast: { error: mocked.error } }));
vi.mock('./RecreationMediaLibrary', () => ({ default: () => <div>recreation media browser</div> }));
vi.mock('./AssetInspector', () => ({ default: () => <div>inspector</div> }));
vi.mock('./NewLibraryAssetDialog', () => ({ default: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
  mocked.getAssetLibraryIndex.mockResolvedValue({ schema_version: 1, project_id: 'library', assets: [{ asset_type: 'character', asset_id: 'character-1', name: 'Test character', source_scope: 'global', source_container_id: null, selected_variant_id: null, variants: [] }] });
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

it('opens recreation media from the library and returns to semantic assets', async () => {
  render(<AssetLibraryPage />);
  await screen.findByText('Test character');
  fireEvent.click(screen.getByRole('button', { name: 'media' }));
  expect(screen.getByText('recreation media browser')).toBeInTheDocument();
  expect(screen.queryByText('Test character')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'assets' }));
  expect(await screen.findByText('Test character')).toBeInTheDocument();
});
