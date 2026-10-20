import { describe, expect, it } from 'vitest';
import { buildCharacterImagePrompt } from '../lib/characterPrompts';

describe('character prompt style preservation', () => {
    for (const kind of ['full_body', 'three_view', 'headshot'] as const) {
        for (const style of ['真人写实，自然皮肤纹理', '动漫插画，概念设计']) {
            it(`${kind} preserves ${style} without scaffold style injection`, () => {
                const prompt = buildCharacterImagePrompt(kind, '苏砚', style);
                expect(prompt).toContain(style);
                expect(prompt.split('概念设计').length).toBe(style.split('概念设计').length);
                expect(prompt).not.toContain('高质量');
                expect(prompt).not.toContain('杰作级细节');
            });
        }
    }
});
