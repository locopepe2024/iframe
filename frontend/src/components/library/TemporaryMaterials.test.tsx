import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TemporaryMaterials from './TemporaryMaterials';
const mocks = vi.hoisted(() => ({ inventory: vi.fn(), list: vi.fn(), save: vi.fn(), trash: vi.fn(), remove: vi.fn(), restore: vi.fn(), edit: vi.fn(), preview: vi.fn() }));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/lib/api', () => ({ API_URL: '' }));
vi.mock('@/lib/materialLibrary', () => ({ materialLibrary: mocks }));
vi.mock('../modules/playground/PlaygroundImageEditor', () => ({ default: ({ children }: any) => children, usePlaygroundImageEditor: () => mocks.edit }));
const temporary = { id: 'one', title: 'Original image', reference: '/playground/input-media/one.png', media_type: 'image', source_kind: 'editor_output', created_at: 1, proposed_expires_at: 604801, retention_state: 'legacy_review' };
const saved = { id: 'version1', asset_id: 'asset1', title: temporary.title, reference: temporary.reference, content_url: '/playground/material-library/version1/content', media_type: 'image', created_at: 2, retention_state: 'permanent' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.inventory.mockResolvedValue({ items: [temporary], diagnostics: [], next_offset: null, total: 1, date_counts: {} });
  mocks.list.mockResolvedValue([]);
  mocks.trash.mockResolvedValue([]);
  mocks.preview.mockResolvedValue(new Blob(['cover'], { type: 'image/webp' }));
  mocks.save.mockImplementation(async () => { mocks.list.mockResolvedValue([saved]); mocks.inventory.mockResolvedValue({ items: [], diagnostics: [], next_offset: null, total: 0, date_counts: {} }); return saved; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('explains paused expiry, promotes a temporary material and edits a saved exact version', async () => {
  render(<TemporaryMaterials />);
  await screen.findByText('Original image');
  expect(screen.getByText(/Automatic deletion is paused/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
  expect(mocks.edit).toHaveBeenCalledWith(temporary.reference, temporary.title);
  fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(temporary.reference, temporary.title));
  await screen.findByText('Saved to material library.');
  expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Saved materials' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit new version' }));
  expect(mocks.edit).toHaveBeenLastCalledWith(saved.content_url, temporary.title);
});
it('keeps failed saves visible and retryable', async () => {
  mocks.save.mockRejectedValue(new Error('Disk unavailable'));
  render(<TemporaryMaterials />);
  fireEvent.click(await screen.findByRole('button', { name: 'Save to library' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable');
  expect(screen.getByRole('button', { name: 'Save to library' })).toBeEnabled();
});

it('reviews numbered days and sends date/type/search filters to the complete inventory', async () => {
  render(<TemporaryMaterials />);
  await screen.findByText('Original image');
  fireEvent.change(screen.getByLabelText('Review month'), { target: { value: '2026-11' } });
  await screen.findByRole('button', { name: '2026-11-02 · 0 items' });
  fireEvent.click(screen.getByRole('button', { name: '2026-11-02 · 0 items' }));
  fireEvent.click(screen.getByRole('button', { name: 'Videos' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search materials' }), { target: { value: 'movie' } });
  await waitFor(() => expect(mocks.inventory).toHaveBeenLastCalledWith(0, expect.objectContaining({
    query: 'movie', media_type: 'video', temporary_only: true,
    created_after: new Date(2026, 10, 2).getTime() / 1000,
    created_before: new Date(2026, 10, 3).getTime() / 1000,
  })));
  expect(screen.getByLabelText('Find date')).toHaveValue('2026-11-02');
  fireEvent.click(screen.getByRole('button', { name: 'All dates' }));
  await waitFor(() => expect(mocks.inventory.mock.lastCall?.[1]).not.toHaveProperty('created_after'));
  fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
  await waitFor(() => expect(mocks.inventory.mock.lastCall?.[1]).toMatchObject({ media_type: 'audio' }));
});

it('does not append an old page after changing the review date', async () => {
  let resolvePage!: (value: unknown) => void;
  mocks.inventory.mockResolvedValueOnce({ items: [temporary], total: 2, diagnostics: [], next_offset: 48 });
  mocks.inventory.mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }));
  mocks.inventory.mockResolvedValue({ items: [{ ...temporary, id: 'current', title: 'Selected date' }], total: 1, diagnostics: [], next_offset: null });
  render(<TemporaryMaterials />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  fireEvent.change(screen.getByLabelText('Find date'), { target: { value: '2026-11-03' } });
  await screen.findByText('Selected date');
  resolvePage({ items: [{ ...temporary, id: 'old', title: 'Old page' }], total: 2, diagnostics: [], next_offset: null });
  await waitFor(() => expect(screen.queryByText('Old page')).not.toBeInTheDocument());
  expect(screen.getByText('Selected date')).toBeInTheDocument();
});

it('confirms deletion, keeps failures retryable, and restores from the recycle bin', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
  const trashed = { id: 'trash-one', scope: 'temporary', material: temporary, deleted_at: 20 };
  mocks.remove.mockRejectedValueOnce(new Error('Recycle bin unavailable')).mockImplementationOnce(async () => {
    mocks.inventory.mockResolvedValue({ items: [], total: 0, diagnostics: [], next_offset: null });
    mocks.trash.mockResolvedValue([trashed]); return trashed;
  });
  mocks.restore.mockImplementation(async () => {
    mocks.inventory.mockResolvedValue({ items: [temporary], total: 1, diagnostics: [], next_offset: null });
    mocks.trash.mockResolvedValue([]);
  });
  render(<TemporaryMaterials />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Original image' }));
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Original image' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Recycle bin unavailable');
  expect(screen.getByRole('button', { name: 'Delete Original image' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Original image' }));
  await screen.findByText('Moved to recycle bin. You can restore it there.');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Original image' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Recycle bin' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Restore Original image' }));
  await screen.findByText('Material restored.');
  fireEvent.click(screen.getByRole('button', { name: 'Temporary materials' }));
  expect(await screen.findByRole('button', { name: 'Delete Original image' })).toBeInTheDocument();
  expect(mocks.remove).toHaveBeenLastCalledWith('temporary', temporary.id);
  expect(mocks.restore).toHaveBeenCalledWith('trash-one');
  confirm.mockRestore();
});

it('filters saved audio and video by the same local date and preserves unknown dates under all dates', async () => {
  mocks.list.mockResolvedValue([
    { ...saved, id: 'video', title: 'Saved video', media_type: 'video', created_at: new Date(2026, 10, 3, 23, 59).getTime() / 1000 },
    { ...saved, id: 'audio', title: 'Saved audio', media_type: 'audio', created_at: new Date(2026, 10, 4).getTime() / 1000 },
  ]);
  mocks.inventory.mockResolvedValue({ items: [{ ...temporary, created_at: null }], total: 1, diagnostics: [], next_offset: null });
  render(<TemporaryMaterials />);
  await screen.findByText('Original image');
  expect(screen.getByRole('heading', { name: 'Date pending review' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Saved materials' }));
  fireEvent.change(screen.getByLabelText('Find date'), { target: { value: '2026-11-03' } });
  expect(screen.getByText('Saved video')).toBeInTheDocument();
  expect(screen.queryByText('Saved audio')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
  expect(screen.queryByText('Saved video')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All dates' }));
  expect(screen.getByText('Saved audio')).toBeInTheDocument();
});

it('loads temporary and saved video covers through the authenticated preview client', async () => {
  const video = { ...temporary, title: 'Temporary video', reference: '/playground/input-media/clip.mp4', media_type: 'video' };
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-cover');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('IntersectionObserver', undefined);
  mocks.inventory.mockResolvedValue({ items: [video], diagnostics: [], next_offset: null, total: 1, date_counts: {} });
  mocks.list.mockResolvedValue([{ ...saved, title: 'Saved video', media_type: 'video' }]);
  render(<TemporaryMaterials />);
  await screen.findByRole('img', { name: 'Temporary video video cover' });
  expect(mocks.preview).toHaveBeenCalledWith(video.reference, expect.any(AbortSignal));
  const signal = mocks.preview.mock.calls[0][1] as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Saved materials' }));
  await screen.findByRole('img', { name: 'Saved video video cover' });
  expect(mocks.preview).toHaveBeenLastCalledWith(saved.content_url, expect.any(AbortSignal));
  expect(signal.aborted).toBe(true);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-cover');
  createObjectURL.mockRestore();
  revokeObjectURL.mockRestore();
});

it('keeps an unavailable video cover previewable without hiding the material', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  mocks.preview.mockRejectedValue(new Error('Preview unavailable'));
  mocks.inventory.mockResolvedValue({ items: [{ ...temporary, title: 'Video without cover', reference: '/playground/input-media/clip.mp4', media_type: 'video' }], diagnostics: [], next_offset: null, total: 1, date_counts: {} });
  render(<TemporaryMaterials />);
  expect(await screen.findByRole('button', { name: 'Preview Video without cover' })).toBeEnabled();
  await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
  expect(screen.queryByRole('img', { name: /video cover/ })).not.toBeInTheDocument();
});
