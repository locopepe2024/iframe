// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VariantSelector } from './VariantSelector';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const { authenticatedFetch } = vi.hoisted(() => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ API_URL: '', authenticatedFetch }));

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

  fireEvent.click(screen.getByAltText('未命名素材 2'));
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
  expect(screen.getAllByAltText(/未命名素材/)).toHaveLength(1);
  expect((screen.getByAltText('Selected Variant') as HTMLImageElement).src).toContain('second.png');
  await waitFor(() => expect(onDelete).toHaveBeenCalledWith('first'));
  await act(async () => reject(new Error('delete failed')));
  expect(screen.getAllByAltText(/未命名素材/)).toHaveLength(2);
  expect((screen.getByAltText('Selected Variant') as HTMLImageElement).src).toContain('first.png');
  vi.restoreAllMocks();
});

it('renames the selected variant without changing its selection', async () => {
  const onRename = vi.fn().mockResolvedValue(undefined);
  render(<VariantSelector asset={asset} onSelect={vi.fn()} onDelete={vi.fn()} onRename={onRename} onGenerate={vi.fn()} isGenerating={false} />);

  fireEvent.change(screen.getByLabelText('素材名称'), { target: { value: '粮店黄昏·持剑近景' } });
  fireEvent.click(screen.getByRole('button', { name: '保存素材名称' }));
  await waitFor(() => expect(onRename).toHaveBeenCalledWith('first', '粮店黄昏·持剑近景'));
  expect((screen.getByAltText('Selected Variant') as HTMLImageElement).src).toContain('first.png');
});

it('does not show a stale fallback when the only image is being deleted', () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<VariantSelector asset={{ selected_id: 'first', variants: [asset.variants[0]] }} currentImageUrl="first.png" onSelect={vi.fn()} onDelete={() => new Promise<void>(() => {})} onGenerate={vi.fn()} isGenerating={false} />);

  fireEvent.click(screen.getAllByTitle('deleteVariant')[0]);
  expect(screen.queryByAltText('Selected Variant')).toBeNull();
  expect(screen.getByText('noImageGenerated')).toBeTruthy();
  vi.restoreAllMocks();
});


it('shows an authenticated preview after loading and keeps errors distinct from an empty variant list', async () => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:character-preview');
    static revokeObjectURL = vi.fn();
  });
  authenticatedFetch.mockRejectedValueOnce(new Error('preview unavailable'));
  authenticatedFetch.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['image']) });
  const { unmount } = render(<VariantSelector asset={asset} previewLocator={{ scope: 'project', containerId: 'project-1', assetType: 'character', assetId: 'hero' }}
    onSelect={vi.fn()} onDelete={vi.fn()} onGenerate={vi.fn()} isGenerating={false} />);
  expect(screen.queryByText('noImageGenerated')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('previewLoadFailed'));
  authenticatedFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['image']) });
  fireEvent.click(screen.getByRole('button', { name: 'retryPreview' }));
  await waitFor(() => expect(screen.getByAltText('Selected Variant')).toHaveAttribute('src', 'blob:character-preview'));
  expect(screen.queryByText('noImageGenerated')).not.toBeInTheDocument();
  unmount();
  vi.unstubAllGlobals();
});


it('displays a returned generation result without persisting an implicit selection', () => {
  const onSelect = vi.fn();
  const props = { onSelect, onDelete: vi.fn(), onGenerate: vi.fn(), isGenerating: false };
  const { rerender } = render(<VariantSelector asset={{ selected_id: null, variants: [] }} {...props} />);
  expect(screen.getByText('noImageGenerated')).toBeInTheDocument();
  rerender(<VariantSelector asset={{ selected_id: null, variants: [asset.variants[0]] }} {...props} />);
  expect(screen.getByAltText('Selected Variant')).toHaveAttribute('src', expect.stringContaining('first.png'));
  expect(screen.queryByText('noImageGenerated')).not.toBeInTheDocument();
  expect(onSelect).not.toHaveBeenCalled();
});

it('distinguishes a stale selection from an empty pool and permits choosing an available variant', async () => {
  const onSelect = vi.fn();
  render(<VariantSelector asset={{ ...asset, selected_id: 'removed' }} currentImageUrl="legacy.png" onSelect={onSelect} onDelete={vi.fn()} onGenerate={vi.fn()} isGenerating={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent('selectedVariantUnavailable');
  expect(screen.queryByAltText('Selected Variant')).not.toBeInTheDocument();
  expect(screen.queryByText('noImageGenerated')).not.toBeInTheDocument();
  fireEvent.click(screen.getByAltText('未命名素材 2'));
  expect(screen.getByAltText('Selected Variant')).toHaveAttribute('src', expect.stringContaining('second.png'));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith('second'));
});


it('sets the displayed variant as cover and labels character variants', async () => {
  const onSetCover = vi.fn().mockResolvedValue(undefined);
  const onSelect = vi.fn();
  render(<VariantSelector asset={asset} onSelect={onSelect} onDelete={vi.fn()} onGenerate={vi.fn()} isGenerating={false}
    onRename={vi.fn()} variantNameLabel="变体名称" variantNameFallback={(index) => `苏砚-${index + 1}`} onSetCover={onSetCover} />);
  expect(screen.getByAltText('苏砚-1')).toBeInTheDocument();
  expect(screen.getByLabelText('变体名称')).toHaveAttribute('placeholder', '苏砚-1');
  fireEvent.click(screen.getByRole('button', { name: '设为角色封面' }));
  await waitFor(() => expect(onSetCover).toHaveBeenCalledWith('first'));
  expect(onSelect).not.toHaveBeenCalled();
});

it('reports favorite errors and allows retrying', async () => {
  const onFavorite = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  render(<VariantSelector asset={{ ...asset, variants: [{ ...asset.variants[0], is_favorited: true }] }}
    onSelect={vi.fn()} onDelete={vi.fn()} onGenerate={vi.fn()} isGenerating={false} onFavorite={onFavorite} />);
  fireEvent.click(screen.getByRole('button', { name: 'clickToUnfavorite' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('收藏更新失败'));
  fireEvent.click(screen.getByRole('button', { name: 'clickToUnfavorite' }));
  await waitFor(() => expect(onFavorite).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});


it('reports cover errors and permits retrying without changing the selection', async () => {
  const onSetCover = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  render(<VariantSelector asset={asset} onSelect={vi.fn()} onDelete={vi.fn()} onGenerate={vi.fn()} isGenerating={false}
    onRename={vi.fn()} onSetCover={onSetCover} />);
  fireEvent.click(screen.getByRole('button', { name: '设为角色封面' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('角色封面保存失败'));
  fireEvent.click(screen.getByRole('button', { name: '设为角色封面' }));
  await waitFor(() => expect(onSetCover).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

it('keeps authored names and identifies the current cover', () => {
  render(<VariantSelector asset={{ ...asset, variants: [{ ...asset.variants[0], display_name: '黑衣正面' }] }}
    onSelect={vi.fn()} onDelete={vi.fn()} onGenerate={vi.fn()} isGenerating={false} onRename={vi.fn()}
    variantNameFallback={(index) => `苏砚-${index + 1}`} coverVariantId="first" onSetCover={vi.fn()} />);
  expect(screen.getByAltText('黑衣正面')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '当前角色封面' })).toBeDisabled();
});
