import { expect, it } from 'vitest';
import { characterDesignPageSeed, referenceDesignPrompt, updateDesignPageReferences, designReferenceKey, type CharacterDesignPage } from '@/lib/characterDesignPages';

const asset = { id: 'hero', name: '青禾', description: '共享角色描述' };
it('seeds only active matching episode Director character facts, without fixed view instructions', () => {
    const project = { art_direction: { director_profile: { story_map: { people: [{ person_id: 'p1', display_name: '她', variant_character_ids: ['hero'] }] }, canon_state: { characters: [
        { subject: 'p1', value: '成年女性，旧蓝外套，手臂包扎', status: 'active' },
        { subject: 'p1', value: '红裙', status: 'superseded' },
        { subject: 'other', value: '另一个角色', status: 'active' },
    ] } } } };
    expect(characterDesignPageSeed(project, asset)).toEqual({ prompt: '成年女性，旧蓝外套，手臂包扎', source: '当集导演理解 · 角色描述' });
    expect(characterDesignPageSeed(null, asset).source).toContain('角色资产描述');
});

it('imports the selected variant prompt and platform structured semantics into editable text', () => {
    const ref = { asset_type: 'character' as const, asset_id: 'hero', variant_id: 'coat' };
    const text = referenceDesignPrompt(ref, [{ asset_type: 'character', asset_id: 'hero', name: '青禾', source_scope: 'episode',
        variants: [{ id: 'coat', url: 'coat.png', prompt_used: '服装：蓝外套\n动作：举起右手', submission_snapshot: { positive_prompt: '服装：蓝外套\n动作：举起右手', negative_prompt: '', visual_design: { pose: 'raise_right_hand' } } }] }], null);
    expect(text).toContain('raise_right_hand'); expect(text).toContain('服装：蓝外套'); expect(text).toContain('动作：举起右手');
    expect(text).not.toContain('全身');
    const platform = referenceDesignPrompt(ref, [], { title: '侧身举臂', summary: '侧面姿态', semantics: { angle: 'side', pose: 'arm_up' },
        platform_resource_id: 'pose', revision: 1, tags: [], category_path: 'reference/pose' });
    expect(platform).toContain('"angle": "side"');
});

it('does not overwrite authored changes, duplicate inherited blocks, or retain removed untouched reference blocks', () => {
    const ref = { asset_type: 'prop' as const, asset_id: 'coat', variant_id: 'blue' };
    const key = designReferenceKey(ref);
    const page: CharacterDesignPage = { id: 'one', name: '服装', prompt: '用户修改后的红色裙子', negative_prompt: '', mode: 'text', references: [], prompt_source: '', reference_prompts: {} };
    const imported = { [key]: '参考图「蓝外套」：\n服装：蓝外套' };
    const selected = updateDesignPageReferences(page, [ref], imported);
    expect(selected.prompt).toContain(page.prompt);
    expect(updateDesignPageReferences(selected, [ref], imported).prompt).toBe(selected.prompt);
    expect(updateDesignPageReferences(selected, [], {}).prompt).toBe(page.prompt);
    const authored = { ...selected, prompt: selected.prompt.replace('服装：蓝外套', '服装：用户改为白外套') };
    expect(updateDesignPageReferences(authored, [], {}).prompt).toContain('用户改为白外套');
});
