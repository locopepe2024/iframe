// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VariantSelector } from './VariantSelector';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ API_URL: '' }));

const asset = {
  selected_id: 'first',
  variants: [
    { id: 'first', url: 'first.png', created_at: 1 },
    { id: 'second', url: 'second.png', created_at: 2 },
  ],
};

it('switches the main image and filmstrip before selection completes', async () => {
  let finish!: () => void;
  const onSelect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<VariantSelector asset={asset} onSelect={onSelect} onDelete={vi.fn()} onGenerate={vi.fn()} isGenerating={false} />);

  fireEvent.click(screen.getAllByAltText('Variant')[1]);
  expect((screen.getByAltText('Selected Variant') as HTMLImageElement).src).toContain('second.png');
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith('second'));
  await act(async () => finish());
});

it('hides a deleted image immediately and restores it if deletion fails', async () => {
  let reject!: (error: Error) => void;
  const onDelete = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<VariantSelector asset={asset} onSelect={vi.fn()} onDelete={onDelete} onGenerate={vi.fn()} isGenerating={false} />);

  fireEvent.click(screen.getAllByTitle('deleteVariant')[0]);
  expect(screen.getAllByAltText('Variant')).toHaveLength(1);
  expect((screen.getByAltText('Selected Variant') as HTMLImageElement).src).toContain('second.png');
  await waitFor(() => expect(onDelete).toHaveBeenCalledWith('first'));
  await act(async () => reject(new Error('delete failed')));
  expect(screen.getAllByAltText('Variant')).toHaveLength(2);
  expect((screen.getByAltText('Selected Variant') as HTMLImageElement).src).toContain('first.png');
  vi.restoreAllMocks();
});

it('does not show a stale fallback when the only image is being deleted', () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<VariantSelector asset={{ selected_id: 'first', variants: [asset.variants[0]] }} currentImageUrl="first.png" onSelect={vi.fn()} onDelete={() => new Promise<void>(() => {})} onGenerate={vi.fn()} isGenerating={false} />);

  fireEvent.click(screen.getAllByTitle('deleteVariant')[0]);
  expect(screen.queryByAltText('Selected Variant')).toBeNull();
  expect(screen.getByText('noImageGenerated')).toBeTruthy();
  vi.restoreAllMocks();
});
