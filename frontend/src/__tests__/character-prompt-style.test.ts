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

it('does not contradict selected expression or gaze with unconditional neutral defaults', () => {
    for (const type of ['full_body', 'three_view', 'headshot'] as const) {
        const prompt = buildCharacterImagePrompt(type, '苏砚', '嘴部表现：嘴角上扬。视线表现：目光低垂。');
        expect(prompt).toContain('嘴部表现：嘴角上扬');
        expect(prompt).toContain('视线表现：目光低垂');
        expect(prompt).toContain('未指定表情时采用中性表情');
        expect(prompt).not.toContain('中性表情，正面看向镜头');
    }
});

it('projects full-body character design into a non-contradictory headshot prompt', () => {
    const prompt = buildCharacterImagePrompt('headshot', '探子首领',
        '面容：下颌轮廓较分明。发型：低盘发髻。服装：上身穿深青色里衣和黑色窄袖长袍。下穿黑色长裤，脚穿素面布靴。构图与背景：人物自然站立，全身服装与鞋履完整可见。');
    expect(prompt).toContain('上身穿深青色里衣和黑色窄袖长袍');
    expect(prompt).not.toContain('下穿黑色长裤');
    expect(prompt).not.toContain('脚穿素面布靴');
    expect(prompt).not.toContain('全身服装与鞋履完整可见');
    expect(prompt).toContain('头肩构图');
});
