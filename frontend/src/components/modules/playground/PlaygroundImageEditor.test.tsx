import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ImageEditorProps } from '@/components/shared/image-editor/ImageEditor';
import PlaygroundImageEditor, { ImageEditorButton, StandaloneImageEditorPage, usePlaygroundImageEditor } from './PlaygroundImageEditor';
import { usePlaygroundStore } from './usePlaygroundStore';
const mocks = vi.hoisted(() => ({ load: vi.fn(), list: vi.fn(), save: vi.fn(), upload: vi.fn(), history: vi.fn(), toast: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
const translate = (key: string) => key;
vi.mock('@/lib/imageEditor', () => ({ imageEditorApi: mocks }));
vi.mock('@/lib/api', () => ({ API_URL: '/api-proxy', playgroundApi: { uploadMedia: mocks.upload, getHistory: mocks.history } }));
vi.mock('@/store/toastStore', () => ({ toast: { success: mocks.toast } }));
vi.mock('./ImageEditorReferenceTools', () => ({ PANORAMA_PROMPT_PREFIX: 'Panorama: ', default: (props: { onUseResult: (path: string, title: string, options?: { panoramaCandidate: true }) => void; onGenerationChange: (generation: unknown) => void }) => <><button onClick={() => {
  props.onGenerationChange({ id: 'generated', status: 'completed', outputs: [{ id: 'image', media_type: 'image', media_path: '/playground/media/generated/image' }] });
  props.onUseResult('/playground/media/generated/image', 'Generated');
}}>Generated result</button><button onClick={() => props.onUseResult('/playground/media/panorama/image', 'Panorama', { panoramaCandidate: true })}>Panorama result</button></> }));
vi.mock('next/dynamic', () => ({ default: () => function Editor(props: ImageEditorProps) {
  return <div>{props.leftPanel}{props.toolPanel}<span data-testid="editor-view">{props.initialView}</span><span data-testid="panorama-gate">{props.panoramaEligible ? 'browse' : 'none'}:{props.panoramaSaveEligible ? 'save' : 'no-save'}</span><span data-testid="canvas-source">{props.source}</span>{props.source ? <button onClick={() => {
    const file = new File(['edited'], 'edited.png');
    file.arrayBuffer = async () => new TextEncoder().encode('edited').buffer;
    void props.onSave(file);
  }}>Save</button> : props.emptyState}{props.onSavePanoramaSource && <button onClick={() => void props.onSavePanoramaSource?.()}>Save panorama</button>}<button onClick={props.onClose}>Close</button></div>;
} }));
const saved = { id: 'edit', path: '/playground/input-media/edit.png', title: 'Edited' };
function OpenSource() { const open = usePlaygroundImageEditor(); return <button onClick={() => open?.('/playground/input-media/source.png', 'source')}>Open source</button>; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([saved]);
  mocks.history.mockResolvedValue([]);
  mocks.load.mockResolvedValue({ source: { reference: '/playground/input-media/source.png', sha256: 'a'.repeat(64) }, blob: new Blob(['source']) });
  mocks.save.mockResolvedValue(saved);
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) }, randomUUID: () => 'operation-key' });
  URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn();
  usePlaygroundStore.setState({ activeSessionId: 'original', mode: 'i2v', inputMedia: ['/first.png', '/second.png'] });
});
afterEach(() => { cleanup(); window.location.hash = ''; vi.unstubAllGlobals(); });
it('appends a saved edit without replacing ordered references or changing mode', async () => {
  render(<PlaygroundImageEditor><OpenSource /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('Open source'));
  fireEvent.click(await screen.findByText('Save'));
  await waitFor(() => expect(usePlaygroundStore.getState().inputMedia).toEqual(['/first.png', '/second.png', saved.path]));
  expect(usePlaygroundStore.getState().mode).toBe('i2v');
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ sha256: 'a'.repeat(64) }), expect.any(File), 'operation-key');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});
it('keeps saved copies in the left tool list after reopening', async () => {
  render(<PlaygroundImageEditor><ImageEditorButton /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('title')); await screen.findByText('Edited');
  fireEvent.click(screen.getByText('Close')); fireEvent.click(screen.getByText('title'));
  fireEvent.click(await screen.findByText('Edited'));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(saved.path, expect.any(AbortSignal)));
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
it('loads a generated image into the main canvas without closing the workbench', async () => {
  render(<PlaygroundImageEditor><OpenSource /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('Open source'));
  await screen.findByText('Save');
  fireEvent.click(screen.getByText('Generated result'));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledWith('/playground/media/generated/image', expect.any(AbortSignal)));
  expect(screen.queryByTestId('comparison-source')).not.toBeInTheDocument();
  expect(screen.getByTestId('canvas-source')).toHaveTextContent('blob:preview');
  expect(screen.getByText('Close')).toBeInTheDocument();
});
it('restores an unsaved generation from server history after reopening and adds it to references', async () => {
  const path = '/playground/media/history/image';
  mocks.history.mockResolvedValue([{ id: 'history', mode: 't2i', status: 'completed', prompt: 'A quiet room', outputs: [{ id: 'image', media_type: 'image', media_path: path }] }]);
  render(<PlaygroundImageEditor><OpenSource /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('Open source'));
  await screen.findByRole('button', { name: 'A quiet room' });
  fireEvent.click(screen.getByText('Close'));
  fireEvent.click(screen.getByText('Open source'));
  fireEvent.click(await screen.findByRole('button', { name: 'addReference A quiet room' }));
  expect(screen.getByRole('button', { name: 'addReference A quiet room' })).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: 'A quiet room' }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(path, expect.any(AbortSignal)));
  expect(screen.queryByRole('button', { name: 'A quiet room' })).not.toBeInTheDocument();
  expect(mocks.history).toHaveBeenCalledTimes(2);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('moves the displaced generated image into the left queue when the main image changes', async () => {
  const newest = '/playground/media/generated/image';
  const older = '/playground/media/older/image';
  mocks.history.mockResolvedValue([
    { id: 'generated', mode: 't2i', status: 'completed', prompt: 'New image', outputs: [{ id: 'image', media_type: 'image', media_path: newest }] },
    { id: 'older', mode: 't2i', status: 'completed', prompt: 'Older image', outputs: [{ id: 'image', media_type: 'image', media_path: older }] },
  ]);
  render(<PlaygroundImageEditor><ImageEditorButton /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('title'));
  await screen.findByRole('button', { name: 'Older image' });
  fireEvent.click(screen.getByRole('button', { name: 'Generated result' }));
  expect(screen.queryByRole('button', { name: 'New image' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Older image' }));
  expect(screen.queryByRole('button', { name: 'Older image' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New image' })).toBeInTheDocument();
});
it('shows five recent image thumbnails with six-character labels before expanding', async () => {
  mocks.history.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({
    id: `image-${index}`, mode: 't2i', status: 'completed', prompt: `Filename${index}`,
    outputs: [{ id: 'image', media_type: 'image', media_path: `/playground/media/${index}/image`, thumbnail_path: `/playground/media/${index}/thumb` }],
  })));
  render(<PlaygroundImageEditor><ImageEditorButton /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('title'));
  expect(await screen.findByRole('button', { name: 'Filename0' })).toHaveTextContent('Filena...');
  expect(screen.getByRole('button', { name: 'Filename0' }).querySelector('img')).toHaveAttribute('src', expect.stringContaining('/playground/media/0/thumb'));
  expect(screen.queryByRole('button', { name: 'Filename5' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'moreHistory' }));
  expect(screen.getByRole('button', { name: 'Filename5' })).toBeInTheDocument();
});
it('pages past newer tasks when looking for older generated images', async () => {
  const newer = Array.from({ length: 100 }, (_, index) => ({ id: `video-${index}`, mode: 't2v', status: 'completed', prompt: 'Video', outputs: [] }));
  mocks.history.mockResolvedValueOnce(newer).mockResolvedValueOnce([{ id: 'old-image', mode: 't2i', status: 'completed', prompt: 'Old image', outputs: [{ id: 'image', media_type: 'image', media_path: '/playground/media/old-image/image' }] }]);
  render(<PlaygroundImageEditor><ImageEditorButton /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('title'));
  fireEvent.click(await screen.findByRole('button', { name: 'moreHistory' }));
  expect(await screen.findByRole('button', { name: 'Old image' })).toBeInTheDocument();
  expect(mocks.history).toHaveBeenNthCalledWith(2, 100, 100);
});
it('opens a non-2:1 panorama candidate in the main viewer without enabling panorama save', async () => {
  mocks.load.mockResolvedValue({ source: { reference: '/playground/media/panorama/image', sha256: 'a'.repeat(64), width: 1024, height: 600, mime: 'image/png' }, blob: new Blob(['candidate']) });
  render(<PlaygroundImageEditor><ImageEditorButton /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('title'));
  fireEvent.click(screen.getByText('Panorama result'));
  await waitFor(() => expect(screen.getByTestId('editor-view')).toHaveTextContent('panorama'));
  expect(screen.getByTestId('panorama-gate')).toHaveTextContent('browse:no-save');
});
it('writes explicit panorama metadata only through the save panorama action', async () => {
  mocks.load.mockResolvedValue({ source: { reference: '/playground/input-media/pano.png', sha256: 'a'.repeat(64), width: 800, height: 400, mime: 'image/png' }, blob: new Blob(['panorama'], { type: 'image/png' }) });
  render(<PlaygroundImageEditor><OpenSource /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('Open source'));
  fireEvent.click(await screen.findByText('Save panorama'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.anything(), expect.any(File), 'operation-key', 'equirectangular'));
});
it('opens the standalone page directly into the editor workbench', () => {
  render(<StandaloneImageEditorPage />);
  expect(screen.getByText('Generated result')).toBeInTheDocument();
  expect(screen.queryByText('open')).not.toBeInTheDocument();
});
it('keeps a saved panorama entry to the director in the left list', async () => {
  mocks.list.mockResolvedValue([{ ...saved, projection_type: 'equirectangular' }]);
  render(<PlaygroundImageEditor><ImageEditorButton /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('title'));
  fireEvent.click(await screen.findByRole('button', { name: 'openDirector Edited' }));
  expect(window.location.hash).toBe('#/director');
});
it('does not insert a delayed save into a different session', async () => {
  let finish!: (value: typeof saved) => void;
  mocks.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<PlaygroundImageEditor><OpenSource /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('Open source')); fireEvent.click(await screen.findByText('Save'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  usePlaygroundStore.setState({ activeSessionId: 'other', inputMedia: ['/other.png'] });
  finish(saved);
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('saved'));
  expect(usePlaygroundStore.getState().inputMedia).toEqual(['/other.png']);
});
