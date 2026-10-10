import { describe, expect, it } from 'vitest';
import { mediaReferenceLabel, referenceKey, referenceName } from '@/components/modules/playground/referenceMedia';
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
    it('uses session, time and output identity instead of generated prompt text', () => {
        const history = [{ session_id: 'session-123', created_at: '2026-10-08T02:03:04.123Z', prompt: '@优化@images (7).jpeg 设计角色', outputs: [{ id: 'output-456', media_path: '/playground/media/g/o?signature=old', media_type: 'image' }] }];
        const label = mediaReferenceLabel('session-123', '2026-10-08T02:03:04.123Z', 'output-456');
        expect(referenceName('/playground/media/g/o?signature=new', {}, history)).toBe(label);
        expect(referenceName('/playground/media/g/o?signature=new', { '/playground/media/g/o': history[0].prompt }, history)).toBe(label);
        expect(referenceName('/playground/media/g/o?signature=new', { '/playground/media/g/o': 'My street' }, history)).toBe('My street');
    });
    it('ignores a legacy prompt-derived media name containing @', () => {
        const path = '/playground/input-media/12345678-1234-1234-1234-123456789abc.jpeg';
        expect(referenceName(path, { [path]: '@优化@images (7).jpeg 设计角色' }, [])).toBe('素材-12345678');
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
