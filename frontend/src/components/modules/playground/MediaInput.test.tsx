import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MediaInput from './MediaInput';
import { usePlaygroundStore } from './usePlaygroundStore';
const upload = vi.hoisted(() => vi.fn().mockResolvedValue({ path: '/new.png' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ playgroundApi: { uploadMedia: upload } }));
vi.mock('./AssetPickerModal', () => ({ default: () => null }));
it('retains one upload/library panel and replaces a single reference on upload', async () => {
  usePlaygroundStore.setState({ mode: 'i2v', modelId: 'test', inputMedia: ['/old.png'] });
  const { container } = render(<MediaInput />);
  expect(screen.getByText('media.localUpload')).toBeInTheDocument();
  expect(screen.getByText('media.pickFromLibrary')).toBeInTheDocument();
  expect(screen.queryByText('media.replaceFile')).not.toBeInTheDocument();
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } });
  await waitFor(() => expect(usePlaygroundStore.getState().inputMedia).toEqual(['/new.png']));
});
