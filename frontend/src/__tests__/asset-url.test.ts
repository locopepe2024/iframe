import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ API_URL: 'https://garage.uniart.fun' }));

import { getAssetUrl } from '@/lib/utils';

describe('protected media previews', () => {
    it.each([
        '/playground/input-media/reference.png',
        '/playground/input-media/reference.mp4',
        '/playground/media/generation/output?signature=test',
        '/studio/media/image?signature=test',
    ])('preserves the media endpoint for %s', (path) => {
        expect(getAssetUrl(path)).toBe(`https://garage.uniart.fun${path}`);
    });

    it('keeps legacy file references on the files endpoint', () => {
        expect(getAssetUrl('output/uploads/reference.png')).toBe(
            'https://garage.uniart.fun/files/output/uploads/reference.png',
        );
    });
});
