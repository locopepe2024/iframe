import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import NewLibraryAssetDialog from './NewLibraryAssetDialog';
import { api } from '@/lib/api';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({
  API_URL: 'https://garage.uniart.fun',
  api: {
    createLibraryAsset: vi.fn().mockResolvedValue({ id: 'asset' }),
    uploadLibraryImage: vi.fn(),
  },
}));
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('registers a workbench image as the initial variant of a typed asset', async () => {
  render(
    <NewLibraryAssetDialog
      initialImageUrl="output/playground/images/result.png"
      initialImageOrigin="workbench"
      initialSourceGenerationId="generation-1"
      initialSourceOutputId="output-1"
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('nameLabel'), { target: { value: '女主播' } });
  fireEvent.submit(screen.getByRole('button', { name: 'create' }).closest('form')!);

  await waitFor(() => expect(api.createLibraryAsset).toHaveBeenCalledWith('character', {
    name: '女主播',
    description: undefined,
    image_url: 'output/playground/images/result.png',
    image_origin: 'workbench',
    source_generation_id: 'generation-1',
    source_output_id: 'output-1',
  }));
});
