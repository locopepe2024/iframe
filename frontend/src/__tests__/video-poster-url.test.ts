import { expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({ API_URL: 'https://iframe.example' }));
import { getVideoPosterUrl } from '@/lib/utils';
const owner = '0123456789abcdef01234567';
it('derives a poster from stale same-backend Studio signatures', () => {
    expect(getVideoPosterUrl(`https://iframe.example/studio/media/${owner}/a.mp4?expires=1&signature=old`))
        .toBe(`https://iframe.example/studio/owned-media/${owner}/a.mp4?preview=320`);
});
it('encodes imported filenames and replaces preview parameters once', () => {
    expect(getVideoPosterUrl(`output/users/${owner}/playground/video/样片 1.mp4`))
        .toBe(`https://iframe.example/studio/owned-playground-media/${owner}/video/${encodeURIComponent('样片 1.mp4')}?preview=320`);
    expect(getVideoPosterUrl(`/studio/owned-media/${owner}/a.mp4?preview=960`))
        .toBe(`https://iframe.example/studio/owned-media/${owner}/a.mp4?preview=320`);
});
it.each([undefined, '', 'https://provider.example/a.mp4', '/playground/media/g/o?expires=1&signature=s'])('keeps unsupported poster source %s empty', (source) => {
    expect(getVideoPosterUrl(source)).toBe('');
});
