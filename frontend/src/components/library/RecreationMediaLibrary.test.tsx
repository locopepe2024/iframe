import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import RecreationMediaLibrary from './RecreationMediaLibrary';
import { recreationApi, RecreationMedia, RecreationMediaPage } from '@/lib/recreation';
vi.mock('@/lib/recreation', () => ({ recreationApi: { list: vi.fn(), searchMedia: vi.fn() } }));
vi.mock('@/lib/api', () => ({ API_URL: 'https://api.example.test' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: { name?: string }) => values?.name ? `${key} ${values.name}` : key }));
const item = (id: string): RecreationMedia => ({ media_id: id, project_id: 'p', kind: 'evidence_frame', display_name: id, storage_path: '/frame.jpg?signature=test', sha256: 'hash', created_at: 1, metadata: { parent_media_id: 'original', pts: 61696, time_base: '1/15360' } });
const videoItem = (id: string, kind: RecreationMedia['kind']): RecreationMedia => ({ media_id: id, project_id: 'p', kind, display_name: id, storage_path: `/${id}.mp4?signature=test`, sha256: 'hash', created_at: 1, metadata: {} });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(recreationApi.list).mockResolvedValue([{ id: 'p', title: 'Original' } as never]);
});
it('paginates without duplicate identities, previews lineage, and retries a failed page', async () => {
  vi.mocked(recreationApi.searchMedia).mockResolvedValueOnce({ items: [item('one')], next_cursor: 24 })
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [item('one'), item('two')], next_cursor: null });
  render(<RecreationMediaLibrary />);
  fireEvent.click(await screen.findByRole('button', { name: 'preview one' }));
  expect(screen.getByText('original')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'one' })).toHaveAttribute('src', 'https://api.example.test/frame.jpg?signature=test');
  fireEvent.click(screen.getByRole('button', { name: 'more' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'preview one' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'retry' }));
  await screen.findByRole('button', { name: 'preview two' });
  expect(screen.getAllByRole('button', { name: 'preview one' })).toHaveLength(1);
  expect(recreationApi.searchMedia).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 24, limit: 24 }));
});
it('resets pages for server filters and ignores older responses', async () => {
  let resolveOld!: (page: RecreationMediaPage) => void;
  vi.mocked(recreationApi.searchMedia).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue({ items: [item('new')], next_cursor: null });
  render(<RecreationMediaLibrary />);
  fireEvent.change(screen.getByLabelText('search'), { target: { value: 'needle' } });
  fireEvent.click(screen.getByRole('button', { name: 'searchButton' }));
  await screen.findByRole('button', { name: 'preview new' });
  resolveOld({ items: [item('old')], next_cursor: 24 });
  fireEvent.change(screen.getByLabelText('kind'), { target: { value: 'evidence_frame' } });
  fireEvent.change(screen.getByLabelText('project'), { target: { value: 'p' } });
  await waitFor(() => expect(recreationApi.searchMedia).toHaveBeenLastCalledWith({ q: 'needle', kind: 'evidence_frame', project_id: 'p', cursor: 0, limit: 24 }));
  expect(screen.queryByRole('button', { name: 'preview old' })).not.toBeInTheDocument();
});

it('keeps source, generated, and final videos playable in the recreation library', async () => {
  vi.mocked(recreationApi.searchMedia).mockResolvedValue({
    items: [videoItem('source', 'source_video'), videoItem('generated', 'generated_video'), videoItem('final', 'final_video')],
    next_cursor: null,
  });
  render(<RecreationMediaLibrary />);

  await screen.findByRole('button', { name: 'preview source' });
  expect(screen.getByRole('option', { name: 'generated_video' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'final_video' })).toBeInTheDocument();
  expect(document.querySelectorAll('button video')).toHaveLength(3);

  fireEvent.click(screen.getByRole('button', { name: 'preview final' }));
  const selectedVideo = document.querySelector('video[controls]');
  expect(selectedVideo).toHaveAttribute('src', 'https://api.example.test/final.mp4?signature=test');
  expect(screen.queryByRole('img', { name: 'final' })).not.toBeInTheDocument();
});
