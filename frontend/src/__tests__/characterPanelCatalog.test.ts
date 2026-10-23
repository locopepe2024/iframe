import { expect, it } from 'vitest';
import { CHARACTER_DICTIONARY_PRESETS } from '@/lib/characterDictionaryPresets';
import { CHARACTER_PANEL_GROUPS, CHARACTER_PANEL_LABELS, CHARACTER_PANEL_ORDER } from '@/lib/characterPanelCatalog';

it('classifies each configuration panel exactly once without changing stable IDs', () => {
  const ids = CHARACTER_DICTIONARY_PRESETS.filter((entry) => entry.type === '配置面板').map((entry) => entry.id);
  expect(CHARACTER_PANEL_ORDER).toHaveLength(new Set(CHARACTER_PANEL_ORDER).size);
  expect([...CHARACTER_PANEL_ORDER].sort()).toEqual([...ids].sort());
  expect(CHARACTER_PANEL_GROUPS.every((group) => group.panels.every(([id, label]) => CHARACTER_PANEL_LABELS[id] === label))).toBe(true);
});
