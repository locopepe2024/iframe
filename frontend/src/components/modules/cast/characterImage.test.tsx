import { describe, expect, it } from 'vitest';
import { characterImageUrl, characterReferenceVariants } from '@/lib/characterImage';

const deletedView = { id: 'deleted-view', url: '/files/deleted-view.png' } as any;
const currentView = { id: 'current-view', url: '/files/current-view.png' } as any;

describe('character image resolution', () => {
    it('prefers the indexed full-body asset over an old compatibility view', () => {
        const character = {
            id: 'character-1',
            name: 'Test',
            full_body_asset: { selected_id: 'current-view', variants: [currentView] },
            full_body: { selected_image_id: 'deleted-view', image_variants: [deletedView] },
            full_body_image_url: currentView.url,
        } as any;

        expect(characterImageUrl(character)).toBe(currentView.url);
        expect(characterReferenceVariants(character).map((variant) => variant.id)).toEqual(['current-view']);
    });

    it('keeps the older image payload as a fallback when current containers are absent', () => {
        const character = {
            id: 'legacy-character',
            name: 'Legacy',
            full_body: { selected_image_id: 'deleted-view', image_variants: [deletedView] },
        } as any;

        expect(characterImageUrl(character)).toBe(deletedView.url);
        expect(characterReferenceVariants(character).map((variant) => variant.id)).toEqual(['deleted-view']);
    });
});
