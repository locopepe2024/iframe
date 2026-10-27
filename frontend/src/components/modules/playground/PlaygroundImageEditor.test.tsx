import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ImageEditorProps } from '@/components/shared/image-editor/ImageEditor';
import PlaygroundImageEditor, { ImageEditorButton, StandaloneImageEditorPage, usePlaygroundImageEditor } from './PlaygroundImageEditor';
import { usePlaygroundStore } from './usePlaygroundStore';
const mocks = vi.hoisted(() => ({ load: vi.fn(), list: vi.fn(), save: vi.fn(), upload: vi.fn(), toast: vi.fn(), library: vi.fn(), importVariant: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
const translate = (key: string) => key;
vi.mock('@/lib/imageEditor', () => ({ imageEditorApi: { ...mocks, importLibraryVariant: mocks.importVariant } }));
vi.mock('@/lib/api', () => ({ api: { getAssetLibraryIndex: mocks.library }, playgroundApi: { uploadMedia: mocks.upload } }));
vi.mock('@/components/shared/AssetIndexPreview', () => ({ AssetIndexPreview: () => <span data-testid="asset-preview" /> }));
vi.mock('@/store/toastStore', () => ({ toast: { success: mocks.toast } }));
vi.mock('./ImageEditorReferenceTools', () => ({ default: () => null }));
vi.mock('next/dynamic', () => ({ default: () => function Editor(props: ImageEditorProps) {
  return <div>{props.source ? <button onClick={() => {
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
  mocks.library.mockResolvedValue({ assets: [] });
  mocks.importVariant.mockResolvedValue({ path: '/playground/input-media/library.png', title: 'Library image' });
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
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ sha256: 'a'.repeat(64) }), expect.any(File), 'operation-key', 'perspective_plane');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});
it('keeps saved copies available after reopening and appends at the end', async () => {
  render(<PlaygroundImageEditor><ImageEditorButton /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('title'));
  await screen.findByText('Edited');
  fireEvent.click(screen.getByText('Close')); fireEvent.click(screen.getByText('title'));
  fireEvent.click(await screen.findByText('use'));
  expect(usePlaygroundStore.getState().inputMedia).toEqual(['/first.png', '/second.png', saved.path]);
  expect(mocks.list).toHaveBeenCalledTimes(2);
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

it('keeps saved panorama copies in image editing for explicit director import', async () => {
  mocks.list.mockResolvedValue([{ ...saved, projection_type: 'equirectangular' }]);
  render(<PlaygroundImageEditor><ImageEditorButton /></PlaygroundImageEditor>);
  fireEvent.click(screen.getByText('title'));
  expect(await screen.findByText('Edited')).toBeInTheDocument();
  expect(screen.queryByText('openDirector')).not.toBeInTheDocument();
  expect(window.location.hash).toBe('');
});

it('opens the standalone editor immediately and selects a library variant as the editing source', async () => {
  const entry = { source_scope: 'series', source_container_id: 'series-1', asset_type: 'character', asset_id: 'person-1', name: 'Person 1', variants: [{ id: 'v1', url: '/studio/media/person-1' }, { id: 'v2', url: '/studio/media/person-2' }] };
  mocks.library.mockResolvedValue({ assets: [entry] });
  render(<StandaloneImageEditorPage />);
  expect(screen.queryByText('open')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'librarySource' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'Person 1 variant' }), { target: { value: 'v2' } });
  fireEvent.click(await screen.findByRole('button', { name: 'edit Person 1' }));
  await waitFor(() => expect(mocks.importVariant).toHaveBeenCalledWith(entry, 'v2'));
  expect(await screen.findByText('Save')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Close'));
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
  expect(await screen.findByText('Edited')).toBeInTheDocument();
});
