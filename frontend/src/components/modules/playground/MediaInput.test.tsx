import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installUniArtCatalog } from './playgroundModels';
import MediaInput from './MediaInput';
import { usePlaygroundStore } from './usePlaygroundStore';
const upload = vi.hoisted(() => vi.fn().mockResolvedValue({ path: '/new.png' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ playgroundApi: { uploadMedia: upload } }));
vi.mock('./AssetPickerModal', () => ({ default: ({ isOpen, onSelect }: { isOpen: boolean; onSelect: (path: string) => void }) => isOpen ? <button onClick={() => onSelect('/library.png')}>select asset</button> : null }));
beforeEach(() => vi.clearAllMocks());
it('retains one upload/library panel and appends image-edit references on upload', async () => {
  usePlaygroundStore.setState({ mode: 'i2i', modelId: 'test', inputMedia: ['/old.png'] });
  const { container } = render(<MediaInput />);
  expect(screen.getByText('media.localUpload')).toBeInTheDocument();
  expect(screen.getByText('media.pickFromLibrary')).toBeInTheDocument();
  expect(screen.queryByText('media.replaceFile')).not.toBeInTheDocument();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } });
  await waitFor(() => expect(usePlaygroundStore.getState().inputMedia).toEqual(['/old.png', '/new.png']));
});

it('appends library selections to image editing inputs', () => {
  usePlaygroundStore.setState({ mode: 'i2i', modelId: 'test', inputMedia: ['/old.png'] });
  render(<MediaInput />);
  fireEvent.click(screen.getByText('media.pickFromLibrary'));
  fireEvent.click(screen.getByText('select asset'));
  expect(usePlaygroundStore.getState().inputMedia).toEqual(['/old.png', '/library.png']);
});
it('does not overwrite the first frame when a single-input mode is full', () => {
  usePlaygroundStore.setState({ mode: 'i2v', modelId: 'test', inputMedia: ['/old.png'] });
  render(<MediaInput />);
  expect(screen.getByText('media.localUpload')).toBeDisabled();
  expect(screen.getByText('media.pickFromLibrary')).toBeDisabled();
  expect(usePlaygroundStore.getState().inputMedia).toEqual(['/old.png']);
});

it('uses the model catalog limit of sixteen for GPT Image 2.5', async () => {
  installUniArtCatalog([{ id: 'uniart/gpt-image-2.5-flare', api_model_id: 'gpt-image-2.5-flare', display_name: 'GPT Image 2.5', description: '', family: 'gpt-image', provider: 'uniart', capabilities: ['t2i', 'i2i'], inputs: { reference_images: { max: 16 } } }]);
  const existing = Array.from({ length: 15 }, (_, i) => `/image-${i}.png`);
  usePlaygroundStore.setState({ mode: 'i2i', modelId: 'uniart/gpt-image-2.5-flare', inputMedia: existing });
  const { container } = render(<MediaInput />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } });
  await waitFor(() => expect(usePlaygroundStore.getState().inputMedia).toEqual([...existing, '/new.png']));
  expect(screen.getByText('media.localUpload')).toBeDisabled();
});
