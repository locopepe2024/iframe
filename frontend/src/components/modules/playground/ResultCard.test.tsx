import { act, fireEvent, render, screen } from '@testing-library/react';
import { downloadOutput } from './downloadOutput';
import { playgroundApi } from '@/lib/api';
import { expect, it, vi } from 'vitest';
import ResultCard from './ResultCard';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ API_URL: 'https://garage.uniart.fun', playgroundApi: { saveToLibrary: vi.fn() } }));
vi.mock('./downloadOutput', () => ({ downloadOutput: vi.fn() }));
vi.mock('@/components/library/NewLibraryAssetDialog', () => ({
  default: ({ initialImageUrl, initialSourceGenerationId, initialSourceOutputId }: { initialImageUrl?: string; initialSourceGenerationId?: string; initialSourceOutputId?: string }) => (
    <div role="dialog" data-image-url={initialImageUrl} data-generation-id={initialSourceGenerationId} data-output-id={initialSourceOutputId}>import asset</div>
  ),
}));

it.each(['image', 'video'] as const)('appends a %s card reference without replacing or reordering the current draft', (mediaType) => {
  const existing = ['/first.png', '/second.mp4'];
  const path = mediaType === 'image' ? '/new.png' : '/new.mp4';
  usePlaygroundStore.setState({ inputMedia: existing, mode: 'r2v', modelId: 'uniart/minimax-h3-vip', prompt: 'use @1 and @2', parameters: { duration: 15 } });
  render(<ResultCard generation={{
    id: 'reference', mode: 't2i', model_id: 'model', prompt: 'old prompt', input_media: [], parameters: {},
    batch_size: 1, outputs: [{ id: 'out', media_path: path, media_type: mediaType, saved_to_library: false }],
    status: 'completed', created_at: '2026-09-15T08:00:00Z',
  }} />);
  fireEvent.click(screen.getByTitle('card.useAsReference'));
  expect(usePlaygroundStore.getState()).toMatchObject({ inputMedia: [...existing, path], mode: 'r2v', modelId: 'uniart/minimax-h3-vip', prompt: 'use @1 and @2', parameters: { duration: 15 } });
  fireEvent.click(screen.getByTitle('card.useAsReference'));
  expect(usePlaygroundStore.getState().inputMedia).toEqual([...existing, path]);
});

it('toggles the featured mark and reports a failed library save', async () => {
  vi.mocked(playgroundApi.saveToLibrary).mockRejectedValueOnce(new Error('保存失败'));
  render(<ResultCard generation={{
    id: 'mark-test', mode: 't2i', model_id: 'model', prompt: 'test', input_media: [], parameters: {},
    batch_size: 1, outputs: [{ id: 'out', media_path: '/image.png', media_type: 'image', saved_to_library: false }],
    status: 'completed', created_at: '2026-09-15T08:00:00Z',
  }} />);
  const mark = screen.getByRole('button', { name: 'card.featured' });
  fireEvent.click(mark);
  expect(mark).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(mark);
  expect(mark).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'card.saveToLibrary' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
});

it('reports a failed download on the card', async () => {
  vi.mocked(downloadOutput).mockRejectedValueOnce(new Error('下载失败（HTTP 401）'));
  render(<ResultCard generation={{
    id: 'test', mode: 't2i', model_id: 'model', prompt: 'test', input_media: [], parameters: {},
    batch_size: 1, outputs: [{ id: 'out', media_path: '/expired.png', media_type: 'image', saved_to_library: false }],
    status: 'completed', created_at: '2026-09-15T08:00:00Z',
  }} />);
  fireEvent.click(screen.getByRole('button', { name: 'card.download' }));
  expect(downloadOutput).toHaveBeenCalledWith('test', 'out', 'image');
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 401');
});

it('offers image outputs as material-backed assets but keeps video outputs as materials', () => {
  const base: PlaygroundGeneration = {
    id: 'asset-import', mode: 't2i', model_id: 'model', prompt: '主播', input_media: [], parameters: {},
    batch_size: 1, outputs: [{ id: 'out', media_path: '/generated.png', media_type: 'image', saved_to_library: false }],
    status: 'completed', created_at: '2026-09-15T08:00:00Z',
  };
  const { unmount } = render(<ResultCard generation={base} />);
  fireEvent.click(screen.getByRole('button', { name: 'card.importAsAsset' }));
  expect(screen.getByRole('dialog')).toHaveAttribute('data-image-url', '/generated.png');
  expect(screen.getByRole('dialog')).toHaveAttribute('data-generation-id', 'asset-import');
  expect(screen.getByRole('dialog')).toHaveAttribute('data-output-id', 'out');
  unmount();

  render(<ResultCard generation={{ ...base, mode: 't2v', outputs: [{ ...base.outputs[0], media_path: '/generated.mp4', media_type: 'video' }] }} />);
  expect(screen.queryByRole('button', { name: 'card.importAsAsset' })).toBeNull();
});

it.each(['completed', 'failed', 'pending', 'processing'] as const)('deletes a %s card from its time row without opening details', (status) => {
  const generation: PlaygroundGeneration = {
    id: 'test', mode: 't2i', model_id: 'model', prompt: 'test', input_media: [], parameters: {},
    batch_size: 1, outputs: [{ id: 'out', media_path: '/image.png', media_type: 'image', saved_to_library: false }],
    status, created_at: '2026-09-15T08:00:00Z',
  };
  const onDelete = vi.fn();
  const onOpenDetail = vi.fn();
  render(<ResultCard generation={generation} onDelete={onDelete} onOpenDetail={onOpenDetail} />);
  const more = screen.getByRole('button', { name: 'card.more' });
  expect(more.closest('[data-card-time-actions]')?.querySelector('time')).toHaveAttribute('datetime', generation.created_at);
  fireEvent.click(more);
  fireEvent.click(screen.getByRole('menuitem', { name: 'card.delete' }));
  expect(onDelete).toHaveBeenCalledWith(generation);
  expect(onOpenDetail).not.toHaveBeenCalled();
});

it.each(['completed', 'failed', 'pending', 'processing'] as const)('keeps the %s media frame bound to the persisted output ratio', (status) => {
  const { container } = render(<ResultCard generation={{
    id: `ratio-${status}`, mode: 't2v', model_id: 'model', prompt: 'portrait', input_media: [],
    parameters: { aspect_ratio: '9:16' }, batch_size: 1,
    outputs: [{ id: 'out', media_path: '/generated.mp4', media_type: 'video', saved_to_library: false }],
    status, created_at: '2026-09-15T08:00:00Z',
  }} />);
  const media = container.querySelector('[style*="aspect-ratio"]');
  expect(media).toHaveStyle({ aspectRatio: '9 / 16' });
});

it('loads only a video cover when its card approaches the viewport', () => {
  let reveal: ((entry: { isIntersecting: boolean }) => void) | undefined;
  const disconnect = vi.fn();
  const previousObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      reveal = (entry) => callback([entry as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect = disconnect;
    unobserve() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
  try {
    const { container } = render(<ResultCard generation={{
      id: 'lazy-video', mode: 't2v', model_id: 'model', prompt: 'video', input_media: [],
      parameters: {}, batch_size: 1, status: 'completed', created_at: '2026-09-15T08:00:00Z',
      outputs: [{ id: 'out', media_path: '/generated.mp4', thumbnail_path: '/generated-cover.jpg', media_type: 'video', saved_to_library: false }],
    }} />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    act(() => reveal?.({ isIntersecting: true }));
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://garage.uniart.fun/files/generated-cover.jpg');
    expect(container.querySelector('video')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  } finally {
    globalThis.IntersectionObserver = previousObserver;
  }
});
