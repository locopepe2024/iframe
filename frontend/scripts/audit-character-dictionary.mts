/** Read-only audit of bundled entries. Runtime platform catalog is excluded. */
import { CHARACTER_DICTIONARY_PRESETS, dictionaryPresetFields, renderDictionaryPreset } from '../src/lib/characterDictionaryPresets';
import { CHARACTER_QUICK_PRESETS } from '../src/lib/characterQuickActions';
import { CHARACTER_DICTIONARY_GROUPS, localDictionaryCategories } from '../src/lib/characterDictionaryCategories';

const entries = [
  ...CHARACTER_DICTIONARY_PRESETS.map((entry) => ({
    id: entry.id, kind: entry.type, title: entry.title, categories: entry.categories,
    // Terms use their slot insertion value; panels/templates use rendered defaults.
    value: entry.type === '词条' ? entry.slotValue || entry.text : renderDictionaryPreset(entry), source: entry.source,
  })),
  ...CHARACTER_QUICK_PRESETS.filter((entry) => entry.target !== 'route').map((entry) => ({
    id: entry.id, kind: '词条', title: entry.label, categories: localDictionaryCategories(entry.id),
    value: entry.value, source: entry.source,
  })),
];

const groups = (key: (entry: typeof entries[number]) => string) => {
  const indexed = new Map<string, typeof entries>();
  for (const entry of entries) indexed.set(key(entry), [...indexed.get(key(entry)) || [], entry]);
  return [...indexed.entries()].filter(([value, matches]) => value.trim() && matches.length > 1);
};

const panelFields = CHARACTER_DICTIONARY_PRESETS.filter((entry) => entry.type === '配置面板').map((entry) => ({
  id: entry.id, title: entry.title,
  fields: dictionaryPresetFields(entry).map((field) => field.key),
}));
const overlaps = panelFields.flatMap((left, index) => panelFields.slice(index + 1).flatMap((right) => {
  const shared = left.fields.filter((field) => right.fields.includes(field));
  return shared.length ? [{ left: left.id, right: right.id, fields: shared }] : [];
}));

console.log(JSON.stringify({
  totals: {
    entries: entries.length, presets: CHARACTER_DICTIONARY_PRESETS.length,
    quickTerms: CHARACTER_QUICK_PRESETS.filter((entry) => entry.target !== 'route').length,
    panels: panelFields.length, groups: CHARACTER_DICTIONARY_GROUPS.length,
    childCategories: CHARACTER_DICTIONARY_GROUPS.reduce((count, group) => count + group.children.length, 0),
  },
  duplicateIds: groups((entry) => entry.id).map(([key, matches]) => ({ key, ids: matches.map((entry) => entry.id) })),
  panelsWithEmptyDefault: CHARACTER_DICTIONARY_PRESETS.filter((entry) => entry.type === '配置面板' && !renderDictionaryPreset(entry)).map((entry) => entry.id),
  sameKindAndTitle: groups((entry) => `${entry.kind}:${entry.title}`).map(([key, matches]) => ({
    key, entries: matches.map(({ id, categories, value, source }) => ({ id, categories, value, source })),
  })),
  sameKindAndAppliedValue: groups((entry) => entry.value.trim() ? `${entry.kind}:${entry.value}` : '').map(([key, matches]) => ({
    value: key, ids: matches.map((entry) => entry.id),
  })),
  panelFieldOverlaps: overlaps,
}, null, 2));
