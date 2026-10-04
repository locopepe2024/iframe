import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ImageEditorReferenceTools, { generationInputMedia } from './ImageEditorReferenceTools';

const mocks = vi.hoisted(() => ({ models: vi.fn(), library: vi.fn(), generate: vi.fn(), status: vi.fn(), upload: vi.fn(), importVariant: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ API_URL: '/api-proxy', api: { getAssetLibraryIndex: mocks.library }, playgroundApi: { getUniArtModels: mocks.models, generate: mocks.generate, getGenerationStatus: mocks.status, uploadMedia: mocks.upload } }));
vi.mock('@/lib/imageEditor', () => ({ imageEditorApi: { importLibraryVariant: mocks.importVariant } }));

const references = [{ path: '/playground/input-media/one.png', title: 'One' }, { path: '/playground/input-media/two.png', title: 'Two' }];
function writePrompt(value: string) {
  const editor = (screen.getByRole('textbox', { name: 'prompt' }) as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
  act(() => { editor.commands.setContent(`<p>${value}</p>`); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.models.mockResolvedValue({ models: [{ id: 'image-model', display_name: 'Image Model', capabilities: ['i2i'], inputs: { reference_images: { max: 4 } } }] });
  mocks.library.mockResolvedValue({ assets: [] });
  mocks.generate.mockResolvedValue({ id: 'generation-1', status: 'completed', outputs: [] });
});

it('binds named mentions to ordered reference inputs in a generation request', async () => {
  expect(generationInputMedia(references)).toEqual([references[0].path, references[1].path]);
  render(<ImageEditorReferenceTools references={references} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  await screen.findByRole('option', { name: 'Image Model' });
  writePrompt('将@One的背包替换成@Two');
  fireEvent.click(screen.getByRole('button', { name: 'generateImage' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'i2i', model_id: 'image-model', prompt: '将@One的背包替换成@Two', input_media: [references[0].path, references[1].path], media_names: { [references[0].path]: 'One', [references[1].path]: 'Two' } })));
});

it('offers selected reference images when typing @ and opens a completed result on the canvas', async () => {
  const onUseResult = vi.fn();
  mocks.generate.mockResolvedValue({ id: 'generation-2', status: 'completed', outputs: [{ id: 'output', media_type: 'image', media_path: '/playground/media/generation-2/output' }] });
  render(<ImageEditorReferenceTools references={references} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={onUseResult}/>);
  await screen.findByRole('option', { name: 'Image Model' });
  writePrompt('@');
  expect(screen.getAllByRole('option', { name: /@/ })).toHaveLength(2);
  fireEvent.click(screen.getByRole('option', { name: '@One' }));
  expect(screen.getByRole('textbox', { name: 'prompt' })).toHaveTextContent('@One');
  fireEvent.click(screen.getByRole('button', { name: 'generateImage' }));
  await waitFor(() => expect(onUseResult).toHaveBeenCalledWith('/playground/media/generation-2/output', 'generatedImage'));
});

it('imports a selected owner library variant as an ordered reference', async () => {
  const entry = { source_scope: 'project', source_container_id: 'project-1', asset_type: 'scene', asset_id: 'room', name: 'Room', variants: [{ id: 'v1', url: '/studio/media/one' }, { id: 'v2', url: '/studio/media/two' }] };
  mocks.library.mockResolvedValue({ assets: [entry] });
  mocks.importVariant.mockResolvedValue({ path: '/playground/input-media/library-room.png', title: 'Room', sha256: 'b'.repeat(64) });
  const onAdd = vi.fn();
  render(<ImageEditorReferenceTools references={[]} onAdd={onAdd} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'libraryReferences' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'Room variant' }), { target: { value: 'v2' } });
  expect(screen.getByRole('presentation').getAttribute('src')).toContain('/studio/media/two');
  fireEvent.click(screen.getByRole('button', { name: 'addReference Room' }));
  await waitFor(() => expect(mocks.importVariant).toHaveBeenCalledWith(entry, 'v2'));
  expect(onAdd).toHaveBeenCalledWith({ path: '/playground/input-media/library-room.png', title: 'Room' });
});

it('reports a completed generation without an image output', async () => {
  mocks.models.mockResolvedValue({ models: [{ id: 'text-image-model', display_name: 'Text Image Model', capabilities: ['t2i'] }] });
  render(<ImageEditorReferenceTools references={[]} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  await screen.findByRole('option', { name: 'Text Image Model' });
  writePrompt('A quiet room');
  fireEvent.click(screen.getByRole('button', { name: 'generateImage' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('noGeneratedImage');
});

it('marks panorama generation as a candidate in the prompt', async () => {
  render(<ImageEditorReferenceTools references={references} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  await screen.findByRole('option', { name: 'Image Model' });
  fireEvent.click(screen.getByRole('button', { name: 'panoramaGeneration' }));
  writePrompt('A city square');
  fireEvent.click(screen.getByRole('button', { name: 'generatePanoramaCandidate' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('equirectangular panorama') })));
  expect(screen.getByText('panoramaCandidateNote')).toBeInTheDocument();
});

it('can generate a panorama candidate from a blank editor', async () => {
  mocks.models.mockResolvedValue({ models: [{ id: 'text-image-model', display_name: 'Text Image Model', capabilities: ['t2i'] }] });
  render(<ImageEditorReferenceTools references={[]} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  await screen.findByRole('option', { name: 'Text Image Model' });
  fireEvent.click(screen.getByRole('button', { name: 'panoramaGeneration' }));
  writePrompt('A mountain lake');
  fireEvent.click(screen.getByRole('button', { name: 'generatePanoramaCandidate' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ mode: 't2i', model_id: 'text-image-model', input_media: undefined })));
});

it('opens a completed panorama in the viewer even after switching generation mode', async () => {
  const onUseResult = vi.fn();
  mocks.models.mockResolvedValue({ models: [{ id: 'text-image-model', display_name: 'Text Image Model', capabilities: ['t2i'] }] });
  mocks.generate.mockResolvedValue({ id: 'panorama-generation', status: 'completed', outputs: [{ id: 'image', media_type: 'image', media_path: '/playground/media/panorama/image' }] });
  render(<ImageEditorReferenceTools references={[]} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={onUseResult}/>);
  await screen.findByRole('option', { name: 'Text Image Model' });
  fireEvent.click(screen.getByRole('button', { name: 'panoramaGeneration' }));
  writePrompt('A mountain lake');
  fireEvent.click(screen.getByRole('button', { name: 'generatePanoramaCandidate' }));
  fireEvent.click(screen.getByRole('button', { name: 'referenceGeneration' }));
  await waitFor(() => expect(onUseResult).toHaveBeenCalledWith('/playground/media/panorama/image', 'generatedImage', { panoramaCandidate: true }));
  fireEvent.click(screen.getByRole('button', { name: 'browsePanorama' }));
  expect(onUseResult).toHaveBeenLastCalledWith('/playground/media/panorama/image', 'generatedImage', { panoramaCandidate: true });
});
