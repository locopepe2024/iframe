import { expect, it } from 'vitest';
import catalog from '../lib/openAiCanvasPrompts.json';
import { OPEN_AI_CANVAS_PROMPTS } from '../lib/openAiCanvasPrompts';

it('preserves every imported text and explicit task without importing media or identity fields', () => {
  expect(catalog.entries).toHaveLength(87);
  expect(new Set(catalog.entries.map(entry => entry.id)).size).toBe(87);
  expect(['style', 'motion', 'nine_grid'].map(kind => catalog.entries.filter(entry => entry.kind === kind).length)).toEqual([45, 33, 9]);
  OPEN_AI_CANVAS_PROMPTS.forEach((entry, index) => {
    expect(entry.text).toBe(catalog.entries[index].prompt);
    expect(entry.promptTask).toBeTruthy();
    expect(entry).not.toHaveProperty('structuredFields');
    expect(entry).not.toHaveProperty('resource');
  });
  expect(JSON.stringify(catalog.entries)).not.toMatch(/https?:\/\/|"owner_id"|"media_url"|"cover"/);
});
