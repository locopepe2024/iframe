import { describe, expect, it } from 'vitest';
import { buildCharacterImagePrompt, hasCharacterReferenceConstraint } from '../lib/characterPrompts';

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

it('does not contradict selected expression or gaze with unconditional neutral defaults', () => {
    for (const type of ['full_body', 'three_view', 'headshot'] as const) {
        const prompt = buildCharacterImagePrompt(type, '苏砚', '嘴部表现：嘴角上扬。视线表现：目光低垂。');
        expect(prompt).toContain('嘴部表现：嘴角上扬');
        expect(prompt).toContain('视线表现：目光低垂');
        expect(prompt).toContain('未指定表情时采用中性表情');
        expect(prompt).not.toContain('中性表情，正面看向镜头');
    }
});

it('frames a portrait reference as identity and hair/skin baseline while allowing bone-shape changes', () => {
    const prompt = buildCharacterImagePrompt("headshot", "苏砚", "骨相调整：脸部纵向轮廓缩短。", true);
    expect(prompt).toContain("以输入的参考图作为角色身份依据，保持发型和肤色");
    expect(prompt).toContain("脸部纵向轮廓缩短");
    expect(prompt).not.toContain("严格保持参考图中的角色面孔、发型、肤色和五官");
    expect(prompt).toMatch(/^主体：.*\n\n参考基准：.*\n\n面部与外观要求：\n[\s\S]*\n\n构图与表现：/);
    expect(hasCharacterReferenceConstraint(prompt)).toBe(true);
});
