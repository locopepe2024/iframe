import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import PreviewImage from './PreviewImage';
import { resolveMediaDelivery } from '@/lib/mediaDelivery';
vi.mock('@/lib/api', () => ({ API_URL: 'https://iframe.example' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./LightboxProvider', () => ({ useLightbox: () => ({ open: vi.fn(), openInGroup: vi.fn() }) }));
vi.mock('@/lib/mediaDelivery', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/mediaDelivery')>(), resolveMediaDelivery: vi.fn() }));
beforeEach(() => {
 vi.clearAllMocks();
 vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
 vi.stubGlobal('IntersectionObserver', undefined);
});
const source = '/playground/media/g/o?expires=1&signature=old';
it('does not create an empty image or duplicate renewal while delivery is pending', async () => {
 let resolve!: (url: string) => void;
 vi.mocked(resolveMediaDelivery).mockReturnValue(new Promise(r => { resolve = r; }));
 const { container, rerender } = render(<PreviewImage src={source} noLightbox />);
 expect(container.querySelector('img')).toBeNull();
 rerender(<PreviewImage src={source.replace('expires=1', 'expires=2')} noLightbox />);
 expect(resolveMediaDelivery).toHaveBeenCalledTimes(1);
 await act(async () => resolve('https://iframe.example/playground/media/g/o?thumbnail=1&signature=new'));
 expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining('thumbnail=1'));
});
it('ignores a stale renewal when the source changes and retries an identical URL once', async () => {
 let oldResolve!: (url: string) => void;
 vi.mocked(resolveMediaDelivery).mockReturnValueOnce(new Promise(r => { oldResolve = r; })).mockResolvedValue('https://iframe.example/playground/media/g/new?thumbnail=1');
 const { container, rerender } = render(<PreviewImage src={source} noLightbox />);
 rerender(<PreviewImage src="/playground/media/g/new" noLightbox />);
 await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/new?')));
 await act(async () => oldResolve('https://iframe.example/stale'));
 const image = container.querySelector('img')!;
 expect(image.src).not.toContain('stale');
 const previous = image.src;
 fireEvent.error(image);
 await waitFor(() => expect(image.src).not.toBe(previous));
 fireEvent.error(image);
 await waitFor(() => expect(container.querySelector('img')).toBeNull());
 expect(resolveMediaDelivery).toHaveBeenCalledTimes(3);
});
it('defers managed preview renewal until its container approaches the viewport', async () => {
 let enter!: IntersectionObserverCallback;
 vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { enter = callback; } observe() {} disconnect() {} });
 vi.mocked(resolveMediaDelivery).mockResolvedValue('https://iframe.example/cover.webp');
 const { container } = render(<PreviewImage src={source} noLightbox />);
 expect(resolveMediaDelivery).not.toHaveBeenCalled();
 await act(async () => enter([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
 await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'https://iframe.example/cover.webp'));
});
