import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AssetLibraryPage from './AssetLibraryPage';
const mocked = vi.hoisted(() => ({
  listSeries: vi.fn().mockResolvedValue([]), getProjects: vi.fn().mockResolvedValue([]),
  listLibraryAssets: vi.fn(), deleteLibraryAsset: vi.fn(), error: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mocked }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: { name?: string }) => values?.name ? `${key} ${values.name}` : key }));
vi.mock('@/store/toastStore', () => ({ toast: { error: mocked.error } }));
vi.mock('./AssetInspector', () => ({ default: () => <div>inspector</div> }));
vi.mock('./NewLibraryAssetDialog', () => ({ default: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
  mocked.listLibraryAssets.mockResolvedValue({ characters: [{ id: 'character-1', name: 'Test character' }], scenes: [], props: [] });
});
it('deletes a library character without selecting its card', async () => {
  mocked.deleteLibraryAsset.mockResolvedValue({ status: 'deleted' });
  render(<AssetLibraryPage />);
  const button = await screen.findByRole('button', { name: 'deleteNamed Test character' });
  mocked.listLibraryAssets.mockResolvedValue({ characters: [], scenes: [], props: [] });
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
