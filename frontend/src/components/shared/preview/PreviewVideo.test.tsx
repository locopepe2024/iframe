import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import PreviewVideo from './PreviewVideo';

vi.mock('@/lib/api', () => ({ API_URL: 'https://iframe.example' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./LightboxProvider', () => ({ useLightbox: () => ({ open: vi.fn(), openInGroup: vi.fn() }) }));
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        disconnect() {}
    });
});
const owner = '0123456789abcdef01234567';
it.each(['studio', 'playground'])('provides a first-frame poster for owner-local %s videos', (area) => {
    const { container } = render(<PreviewVideo src={`users/${owner}/${area}/video/a.mp4`} />);
    const video = container.querySelector('video')!;
    const route = area === 'studio' ? 'owned-media' : 'owned-playground-media';
    expect(video.getAttribute("poster")).toBe(`https://iframe.example/studio/${route}/${owner}/video/a.mp4?preview=320`);
    expect(video.src).not.toContain('preview=');
});
it('keeps an explicitly supplied poster and external playback URL', () => {
    const { container } = render(<PreviewVideo src="https://provider.example/a.mp4" poster="https://provider.example/still.jpg" />);
    const video = container.querySelector('video')!;
    expect(video.getAttribute("poster")).toBe('https://provider.example/still.jpg');
    expect(video.src).toBe('https://provider.example/a.mp4');
});
it('does not request a backend poster for external videos', () => {
    const { container } = render(<PreviewVideo src="https://provider.example/a.mp4" />);
    expect(container.querySelector('video')).not.toHaveAttribute('poster');
});
