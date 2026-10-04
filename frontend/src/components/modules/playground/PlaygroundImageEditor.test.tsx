import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ImageEditorProps } from '@/components/shared/image-editor/ImageEditor';
import PlaygroundImageEditor, { ImageEditorButton, StandaloneImageEditorPage, usePlaygroundImageEditor } from './PlaygroundImageEditor';
import { usePlaygroundStore } from './usePlaygroundStore';
const mocks = vi.hoisted(() => ({ load: vi.fn(), list: vi.fn(), save: vi.fn(), upload: vi.fn(), toast: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
const translate = (key: string) => key;
vi.mock('@/lib/imageEditor', () => ({ imageEditorApi: mocks }));
vi.mock('@/lib/api', () => ({ API_URL: '/api-proxy', playgroundApi: { uploadMedia: mocks.upload } }));
vi.mock('@/store/toastStore', () => ({ toast: { success: mocks.toast } }));
vi.mock('./ImageEditorReferenceTools', () => ({ default: (props: { onUseResult: (path: string, title: string, options?: { panoramaCandidate: true }) => void; onGenerationChange: (generation: unknown) => void }) => <><button onClick={() => {
  props.onGenerationChange({ id: 'generated', status: 'completed', outputs: [{ id: 'image', media_type: 'image', media_path: '/playground/media/generated/image' }] });
  props.onUseResult('/playground/media/generated/image', 'Generated');
}}>Generated result</button><button onClick={() => props.onUseResult('/playground/media/panorama/image', 'Panorama', { panoramaCandidate: true })}>Panorama result</button></> }));
vi.mock('next/dynamic', () => ({ default: () => function Editor(props: ImageEditorProps) {
  return <div>{props.leftPanel}{props.toolPanel}<span data-testid="editor-view">{props.initialView}</span><span data-testid="panorama-gate">{props.panoramaEligible ? 'browse' : 'none'}:{props.panoramaSaveEligible ? 'save' : 'no-save'}</span>{props.comparisonSource && <span data-testid="comparison-source">{props.comparisonSource}</span>}{props.source ? <button onClick={() => {
    const file = new File(['edited'], 'edited.png');
    file.arrayBuffer = async () => new TextEncoder().encode('edited').buffer;
    void props.onSave(file);
  }}>Save</button> : props.emptyState}<button onClick={props.onClose}>Close</button></div>;
} }));
const saved = { id: 'edit', path: '/playground/input-media/edit.png', title: 'Edited' };
function OpenSource() { const open = usePlaygroundImageEditor(); return <button onClick={() => open?.('/playground/input-media/source.png', 'source')}>Open source</button>; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([saved]);
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
  expect(screen.getByTestId('comparison-source')).toHaveTextContent('/playground/input-media/source.png');
  expect(screen.getByText('Close')).toBeInTheDocument();
});
it('opens a non-2:1 panorama candidate in the main viewer without enabling panorama save', async () => {
  mocks.load.mockResolvedValue({ source: { reference: '/playground/media/panorama/image', sha256: 'a'.repeat(64), width: 1024, height: 600, mime: 'image/png' }, blob: new Blob(['candidate']) });
  render(<PlaygroundImageEditor><ImageEditorButton /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('title'));
  fireEvent.click(screen.getByText('Panorama result'));
  await waitFor(() => expect(screen.getByTestId('editor-view')).toHaveTextContent('panorama'));
  expect(screen.getByTestId('panorama-gate')).toHaveTextContent('browse:no-save');
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
