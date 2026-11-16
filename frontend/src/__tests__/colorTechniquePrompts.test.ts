import { expect, it } from 'vitest';
import catalog from '../lib/colorTechniquePrompts.json';
import { COLOR_TECHNIQUE_PROMPTS } from '../lib/colorTechniquePrompts';
import { FILM_COLOR_PROMPTS } from '../lib/filmColorPrompts';
import { OPEN_AI_CANVAS_PROMPTS } from '../lib/openAiCanvasPrompts';

it('adds independent color techniques without replacing film looks or source templates', () => {
  const combined = [...OPEN_AI_CANVAS_PROMPTS, ...FILM_COLOR_PROMPTS, ...COLOR_TECHNIQUE_PROMPTS];
  expect(new Set(combined.map(entry => entry.id)).size).toBe(combined.length);
  expect(combined.filter(entry => entry.promptTask === 'visual-style')).toHaveLength(56);
  expect(combined.filter(entry => entry.promptTask === 'camera-motion')).toHaveLength(33);
  expect(combined.filter(entry => entry.promptTask === 'multi-view')).toHaveLength(9);
  expect(catalog.entries.map(entry => entry.id)).toEqual([
    'color-technique.bleach-bypass', 'color-technique.sepia', 'color-technique.cross-processing',
  ]);
});

it('keeps explanations and combination advice outside editable generation text', () => {
  COLOR_TECHNIQUE_PROMPTS.forEach((entry, index) => {
    const definition = catalog.entries[index];
    expect(entry.text).toBe(definition.prompt);
    expect(entry.promptTag).toBe('色彩技法');
    expect(entry.source).toContain('iFrame 独立编写');
    expect(entry.source).toContain('ScreenWeaver');
    expect(entry.source).not.toContain('MIT');
    expect(new URL(definition.sourceUrl).hostname).toBe('www.screenweaver.ai');
    for (const alias of definition.aliases) expect(entry.search).toContain(alias);
    expect(entry.usageHint).toContain(definition.definition);
    for (const advice of [...definition.useWhen, ...definition.avoidWhen]) {
      expect(entry.usageHint).toContain(advice);
      expect(entry.text).not.toContain(advice);
    }
    for (const key of ['structuredFields', 'resource', 'model', 'ratio', 'reference_assets']) {
      expect(entry).not.toHaveProperty(key);
    }
    expect(entry.text).not.toMatch(/https?:\/\/|\d+mm|8k|masterpiece|--ar/i);
  });
});
