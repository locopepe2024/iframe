import { expect, it } from 'vitest';
import catalog from '../lib/filmColorPrompts.json';
import { FILM_COLOR_PROMPTS } from '../lib/filmColorPrompts';
import { OPEN_AI_CANVAS_PROMPTS } from '../lib/openAiCanvasPrompts';

it('adds eight complementary looks while preserving the existing source catalog', () => {
  expect(FILM_COLOR_PROMPTS).toHaveLength(8);
  expect(OPEN_AI_CANVAS_PROMPTS.filter(entry => entry.promptTask === 'visual-style')).toHaveLength(45);
  const combined = [...OPEN_AI_CANVAS_PROMPTS, ...FILM_COLOR_PROMPTS];
  expect(new Set(combined.map(entry => entry.id)).size).toBe(combined.length);
  expect(FILM_COLOR_PROMPTS.filter(entry => entry.promptTag === '胶片色彩')).toHaveLength(6);
  expect(FILM_COLOR_PROMPTS.filter(entry => entry.promptTag === '黑白影调')).toHaveLength(2);
  expect(catalog.entries.map(entry => entry.referenceAnchor).join(' ')).not.toMatch(/Portra|Gold 200/);
});

it('separates editable color descriptions from provenance, cautions and generation settings', () => {
  expect(catalog.provenance.repository).toContain('wangsuizhi012-bot/nsfw-prompt-templates-asian');
  expect(catalog.provenance.revision).toBe('4a37fa6593a17a77ad8c951492d560e829a0108a');
  expect(catalog.provenance.licenseSource).toBe('README.md');
  FILM_COLOR_PROMPTS.forEach((entry, index) => {
    const definition = catalog.entries[index];
    expect(entry.text).toBe(definition.prompt);
    expect(entry.promptTask).toBe('visual-style');
    expect(entry.editableText).toBe(true);
    expect(entry.search).toContain(definition.referenceAnchor);
    expect(entry.usageHint).toContain('不是精确胶片仿真');
    expect(entry.source).toContain('iFrame 改写');
    expect(entry.source).toContain('4a37fa65');
    expect(definition.sourceLines.length).toBeGreaterThan(0);
    for (const caution of definition.cautions) {
      expect(entry.usageHint).toContain(caution);
      expect(entry.text).not.toContain(caution);
    }
    for (const key of ['preset', 'structuredFields', 'resource', 'model', 'ratio', 'reference_assets']) {
      expect(entry).not.toHaveProperty(key);
    }
    expect(entry.text).not.toMatch(/https?:\/\/|8k|masterpiece|--ar/i);
  });
});
