import catalog from './filmColorPrompts.json';

/** Independently written looks; reference anchors do not assert exact film emulation. */
export const FILM_COLOR_PROMPTS = catalog.entries.map(item => ({
  id: item.id,
  title: item.title,
  text: item.prompt,
  type: 'Prompt 模板' as const,
  categories: ['style'],
  domain: '视觉风格 · 色彩与影调',
  source: `iFrame 改写 · nsfw-prompt-templates-asian · ${catalog.provenance.revision.slice(0, 8)} · MIT（README 声明）`,
  search: `${item.referenceAnchor} ${item.category} ${item.keywords.join(' ')}`,
  promptTask: 'visual-style' as const,
  promptTag: item.category,
  usageHint: `参考方向：${item.referenceAnchor}。仅调整色彩与影调，不替换角色身份、机位或生成设置；不是精确胶片仿真。组合提醒：与以下要求可能冲突：${item.cautions.join('；')}。`,
  editableText: true,
}));
