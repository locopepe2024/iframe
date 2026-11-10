import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { playgroundApi } from '@/lib/api';
import { beforeEach, expect, it, vi } from 'vitest';
import DetailPanel from './DetailPanel';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({
  API_URL: 'https://garage.uniart.fun',
  playgroundApi: { saveToLibrary: vi.fn(), deleteGeneration: vi.fn() },
}));
vi.mock('./downloadOutput', () => ({ downloadOutput: vi.fn() }));
vi.mock('@/components/library/NewLibraryAssetDialog', () => ({
  default: ({ initialImageUrl, initialSourceGenerationId, initialSourceOutputId }: { initialImageUrl?: string; initialSourceGenerationId?: string; initialSourceOutputId?: string }) => (
    <div role="dialog" data-image-url={initialImageUrl} data-generation-id={initialSourceGenerationId} data-output-id={initialSourceOutputId}>import asset</div>
  ),
}));

const imageGeneration: PlaygroundGeneration = {
  id: 'detail-asset',
  mode: 't2i',
  model_id: 'image-model',
  prompt: '主播',
  input_media: [],
  parameters: {},
  batch_size: 1,
  outputs: [{ id: 'out', media_path: '/generated.png', media_type: 'image', saved_to_library: false }],
  status: 'completed',
  created_at: '2026-09-18T08:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  usePlaygroundStore.setState({ history: [] });
});

it('saves the focused video rather than using the first batch output saved state and reports retryable errors', async () => {
  vi.mocked(playgroundApi.saveToLibrary).mockRejectedValueOnce({ response: { data: { detail: 'Video unavailable' } } }).mockResolvedValueOnce({ ok: true });
  const generation: PlaygroundGeneration = { ...imageGeneration, id: 'video-batch', mode: 't2v', outputs: [
    { id: 'first', media_path: '/first.mp4', media_type: 'video', saved_to_library: true },
    { id: 'second', media_path: '/second.mp4', media_type: 'video', saved_to_library: false },
  ] };
  usePlaygroundStore.setState({ history: [generation] });
  render(<DetailPanel generation={generation} focusOutputId="second" allGenerations={[generation]} onClose={vi.fn()} onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'detail.saveToLibrary' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Video unavailable');
  expect(screen.getByRole('button', { name: 'detail.saveToLibrary' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'detail.saveToLibrary' }));
  await waitFor(() => expect(playgroundApi.saveToLibrary).toHaveBeenLastCalledWith('video-batch', 'second'));
  expect(await screen.findByRole('status')).toHaveTextContent('card.savedToLibraryNotice');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('opens the asset recording flow for image and video outputs', () => {
  const props = {
    allGenerations: [imageGeneration],
    onClose: vi.fn(),
    onNavigate: vi.fn(),
  };
  const { unmount } = render(<DetailPanel generation={imageGeneration} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'card.importAsAsset' }));
  expect(screen.getByRole('dialog')).toHaveAttribute('data-image-url', '/generated.png');
  expect(screen.getByRole('dialog')).toHaveAttribute('data-generation-id', 'detail-asset');
  expect(screen.getByRole('dialog')).toHaveAttribute('data-output-id', 'out');
  unmount();

  const videoGeneration: PlaygroundGeneration = {
    ...imageGeneration,
    id: 'detail-video',
    mode: 't2v',
    outputs: [{ id: 'out', media_path: '/generated.mp4', media_type: 'video', saved_to_library: false }],
  };
  render(<DetailPanel generation={videoGeneration} {...props} allGenerations={[videoGeneration]} />);
  fireEvent.click(screen.getByRole('button', { name: 'card.importAsAsset' }));
  expect(screen.getByRole('dialog')).toHaveAttribute('data-image-url', '/generated.mp4');
  expect(screen.getByRole('dialog')).toHaveAttribute('data-generation-id', 'detail-video');
});
