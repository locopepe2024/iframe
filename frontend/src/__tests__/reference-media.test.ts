import { describe, expect, it } from 'vitest';
import { referenceKey, referenceName } from '@/components/modules/playground/referenceMedia';
import { usePlaygroundStore } from '@/components/modules/playground/usePlaygroundStore';

describe('reference display names', () => {
    it('uses original names while keeping equal-name files distinct', () => {
        const a = '/playground/input-media/a.png';
        const b = '/playground/input-media/b.png';
        const names = { [a]: 'portrait.png', [b]: 'portrait.png' };
        expect(referenceName(a, names, [])).toBe('portrait.png');
        expect(referenceName(b, names, [])).toBe('portrait.png');
        expect(referenceKey(a)).not.toBe(referenceKey(b));
    });
    it('retains a generated name across delivery signature refresh', () => {
        const history = [{ prompt: 'Rainy street', outputs: [{ media_path: '/playground/media/g/o?signature=old', media_type: 'image' }] }];
        expect(referenceName('/playground/media/g/o?signature=new', {}, history)).toBe('Rainy street');
        expect(referenceName('/playground/media/g/o?signature=new', { '/playground/media/g/o': 'My street' }, history)).toBe('My street');
    });
    it('decodes filenames without including signed query parameters', () => {
        expect(referenceName('/files/my%20picture.png?signature=secret', {}, [])).toBe('my picture.png');
        expect(referenceKey('https://external.test/media?id=1')).not.toBe(referenceKey('https://external.test/media?id=2'));
    });
    it('restores names with a draft and clears them in an older draft', () => {
        const draft = { mode: 'i2i' as const, model_id: 'test', prompt: '', input_media: ['a'], parameters: {}, batch_size: 1 };
        usePlaygroundStore.getState().applySessionDraft({ ...draft, media_names: { a: 'Portrait' } });
        expect(usePlaygroundStore.getState().mediaNames).toEqual({ a: 'Portrait' });
        usePlaygroundStore.getState().applySessionDraft(draft);
        expect(usePlaygroundStore.getState().mediaNames).toEqual({});
    });
});
