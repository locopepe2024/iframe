import { expect, it } from 'vitest';
import { CHARACTER_EXPRESSION_PROMPTS, EXPRESSION_DETAIL_GROUPS } from '@/lib/characterExpressionPrompts';
import { dictionaryConfiguration, dictionaryPresetFields, dictionaryStructuredFields, renderDictionaryPreset } from '@/lib/characterDictionaryPresets';
import { dictionarySlotCategory } from '@/lib/characterDictionaryCategories';

it('records editable local performance without changing identity, look or global constraints', () => {
  const preset = CHARACTER_EXPRESSION_PROMPTS.find(p => p.id.endsWith('held-tears'))!;
  const values = { 嘴部表现: '嘴唇微张', 面部气色: '' };
  const text = renderDictionaryPreset(preset, values);
  expect(text).toContain('嘴部表现：嘴唇微微张开。');
  expect(text).not.toContain('面部气色');
  const config = dictionaryConfiguration(preset, values);
  expect(config.selections['嘴部表现']).toBe('嘴唇微张');
  expect(config.resolved_fields['嘴部表现']).toBe('嘴唇微微张开');
  expect(config.selections).not.toHaveProperty('面部气色');
  expect(config.rendered_text).toBe(text);
  expect(dictionaryStructuredFields(preset, values)).toEqual({ identity: {}, look: {} });
});
it('supports omission and deferred slots without selecting facial morphology', () => {
  const preset = CHARACTER_EXPRESSION_PROMPTS[0];
  const cleared = Object.fromEntries(EXPRESSION_DETAIL_GROUPS.map(([, label]) => [label, '']));
  expect(renderDictionaryPreset(preset, cleared)).toBe('');
  expect(renderDictionaryPreset(preset, { ...cleared, 嘴部表现: '[嘴部表现]' })).toBe('嘴部表现：[嘴部表现]。');
  for (const [category, label] of EXPRESSION_DETAIL_GROUPS) expect(dictionarySlotCategory(label)).toBe(category);
});
it('offers static presets without timed, scene, beauty or negative defaults', () => {
  expect(CHARACTER_EXPRESSION_PROMPTS).toHaveLength(13);
  for (const preset of CHARACTER_EXPRESSION_PROMPTS) {
    expect(dictionaryPresetFields(preset)).toHaveLength(6);
    expect(renderDictionaryPreset(preset)).not.toMatch(/\[|\d|毫米|秒|AU|随后|呼吸|笑声|背景|光线|磨皮|奶油肌|肤色|牙色|排列/);
    expect(preset.constraints).toBeUndefined();
    for (const field of dictionaryPresetFields(preset)) expect(field.options).toContain(field.value);
  }
});
