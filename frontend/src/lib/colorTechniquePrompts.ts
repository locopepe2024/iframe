import catalog from './colorTechniquePrompts.json';

/** Authored color directions; source names do not imply physical processing or camera settings. */
export const COLOR_TECHNIQUE_PROMPTS = catalog.entries.map(item => ({
  id: item.id,
  title: item.title,
  text: item.prompt,
  type: 'Prompt 模板' as const,
  categories: ['style'],
  domain: '视觉风格 · 色彩技法',
  source: `iFrame 独立编写 · 术语参考 ${catalog.provenance.source}`,
  search: `${item.aliases.join(' ')} ${item.definition} 色彩技法`,
  promptTask: 'visual-style' as const,
  promptTag: '色彩技法',
  usageHint: `技法含义：${item.definition} 适用：${item.useWhen.join('；')}。组合提醒：不宜同时要求${item.avoidWhen.join('；')}。仅描述色彩与影调，不替换角色身份、机位或生成设置；不是精确洗印仿真。`,
  editableText: true,
}));
