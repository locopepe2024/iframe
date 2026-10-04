import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ImageEditorReferenceTools, { generationInputMedia } from './ImageEditorReferenceTools';

const mocks = vi.hoisted(() => ({ models: vi.fn(), library: vi.fn(), generate: vi.fn(), status: vi.fn(), upload: vi.fn(), importVariant: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ API_URL: '/api-proxy', api: { getAssetLibraryIndex: mocks.library }, playgroundApi: { getUniArtModels: mocks.models, generate: mocks.generate, getGenerationStatus: mocks.status, uploadMedia: mocks.upload } }));
vi.mock('@/lib/imageEditor', () => ({ imageEditorApi: { importLibraryVariant: mocks.importVariant } }));

const source = { reference: '/playground/input-media/base.png', sha256: 'a'.repeat(64), width: 512, height: 512, mime: 'image/png' };
const references = [{ path: '/playground/input-media/one.png', title: 'One' }, { path: '/playground/input-media/two.png', title: 'Two' }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.models.mockResolvedValue({ models: [{ id: 'image-model', display_name: 'Image Model', capabilities: ['i2i'], inputs: { reference_images: { max: 4 } } }] });
  mocks.library.mockResolvedValue({ assets: [] });
  mocks.generate.mockResolvedValue({ id: 'generation-1', status: 'completed', outputs: [] });
});

it('preserves ordered base and reference inputs in a generation request', async () => {
  expect(generationInputMedia(source, references)).toEqual([source.reference, references[0].path, references[1].path]);
  render(<ImageEditorReferenceTools source={source} references={references} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  await screen.findByRole('option', { name: 'Image Model' });
  fireEvent.change(screen.getByRole('textbox', { name: 'prompt' }), { target: { value: 'A quiet room' } });
  fireEvent.click(screen.getByRole('button', { name: 'generateImage' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'i2i', model_id: 'image-model', input_media: [source.reference, references[0].path, references[1].path] })));
});

it('imports a selected owner library variant as an ordered reference', async () => {
  const entry = { source_scope: 'project', source_container_id: 'project-1', asset_type: 'scene', asset_id: 'room', name: 'Room', variants: [{ id: 'v1', url: '/studio/media/one' }, { id: 'v2', url: '/studio/media/two' }] };
  mocks.library.mockResolvedValue({ assets: [entry] });
  mocks.importVariant.mockResolvedValue({ path: '/playground/input-media/library-room.png', title: 'Room', sha256: 'b'.repeat(64) });
  const onAdd = vi.fn();
  render(<ImageEditorReferenceTools source={source} references={[]} onAdd={onAdd} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'libraryReferences' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'Room variant' }), { target: { value: 'v2' } });
  expect(screen.getByRole('presentation').getAttribute('src')).toContain('/studio/media/two');
  fireEvent.click(screen.getByRole('button', { name: 'addReference Room' }));
  await waitFor(() => expect(mocks.importVariant).toHaveBeenCalledWith(entry, 'v2'));
  expect(onAdd).toHaveBeenCalledWith({ path: '/playground/input-media/library-room.png', title: 'Room' });
});

it('reports a completed generation without an image output', async () => {
  render(<ImageEditorReferenceTools source={source} references={[]} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  await screen.findByRole('option', { name: 'Image Model' });
  fireEvent.change(screen.getByRole('textbox', { name: 'prompt' }), { target: { value: 'A quiet room' } });
  fireEvent.click(screen.getByRole('button', { name: 'generateImage' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('noGeneratedImage');
});

it('marks panorama generation as a candidate in the prompt', async () => {
  render(<ImageEditorReferenceTools source={source} references={[]} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  await screen.findByRole('option', { name: 'Image Model' });
  fireEvent.click(screen.getByRole('button', { name: 'panoramaGeneration' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'prompt' }), { target: { value: 'A city square' } });
  fireEvent.click(screen.getByRole('button', { name: 'generatePanoramaCandidate' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('equirectangular panorama') })));
  expect(screen.getByText('panoramaCandidateNote')).toBeInTheDocument();
});

it('can generate a panorama candidate from a blank editor', async () => {
  mocks.models.mockResolvedValue({ models: [{ id: 'text-image-model', display_name: 'Text Image Model', capabilities: ['t2i'] }] });
  render(<ImageEditorReferenceTools source={null} references={[]} onAdd={vi.fn()} onRemove={vi.fn()} onMove={vi.fn()} onUseResult={vi.fn()}/>);
  await screen.findByRole('option', { name: 'Text Image Model' });
  fireEvent.click(screen.getByRole('button', { name: 'panoramaGeneration' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'prompt' }), { target: { value: 'A mountain lake' } });
  fireEvent.click(screen.getByRole('button', { name: 'generatePanoramaCandidate' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ mode: 't2i', model_id: 'text-image-model', input_media: undefined })));
});
