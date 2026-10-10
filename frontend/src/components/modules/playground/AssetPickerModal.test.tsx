import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import AssetPickerModal from './AssetPickerModal';

const mocks = vi.hoisted(() => ({ history: vi.fn(), library: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
}));
vi.mock('@/lib/api', () => ({
  playgroundApi: { getHistory: mocks.history },
  api: { getAssetLibraryIndex: mocks.library },
}));
vi.mock('@/lib/utils', () => ({ getAssetUrl: (value: string) => value }));
vi.mock('./referenceMedia', () => ({ referenceKey: (value: string) => value, referenceName: () => 'asset' }));
vi.mock('./usePlaygroundStore', () => ({ usePlaygroundStore: { getState: () => ({ inputMedia: [], mediaNames: {} }) } }));

const library = { assets: [{
  source_scope: 'global', source_container_id: null, asset_type: 'character', asset_id: 'character-1',
  name: '武侠-男-3', variants: [{ id: 'variant-1', url: '/cover.png' }],
}] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.history.mockResolvedValue([]);
  mocks.library.mockResolvedValue(library);
});

it('loads again after closing and reopening the asset picker', async () => {
  const { rerender } = render(<AssetPickerModal isOpen onClose={vi.fn()} onSelect={vi.fn()} accept="image" />);
  expect(await screen.findByRole('button', { name: '武侠-男-3' })).toBeInTheDocument();
  rerender(<AssetPickerModal isOpen={false} onClose={vi.fn()} onSelect={vi.fn()} accept="image" />);
  rerender(<AssetPickerModal isOpen onClose={vi.fn()} onSelect={vi.fn()} accept="image" />);
  await waitFor(() => expect(mocks.library).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('button', { name: '武侠-男-3' })).toBeInTheDocument();
});

it('does not hide the library when one source endpoint fails', async () => {
  mocks.history.mockRejectedValue(new Error('history unavailable'));
  render(<AssetPickerModal isOpen onClose={vi.fn()} onSelect={vi.fn()} accept="image" />);
  expect(screen.getByText('assetPicker.loading')).toBeInTheDocument();
  // The library source is still usable while history is unavailable.
  await waitFor(() => expect(screen.getByRole('button', { name: '武侠-男-3' })).toBeInTheDocument());
});
