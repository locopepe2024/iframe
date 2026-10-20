/** Task, topic and rendering style are independent discovery dimensions. */
export const PROMPT_TASKS = [
  ['character', '角色设计'], ['portrait', '风格写真'], ['outfit', '换装写真'],
  ['commerce', '电商主图'], ['ugc', 'UGC'],
] as const;
export type PromptTask = typeof PROMPT_TASKS[number][0];
export const PROMPT_TOPICS = ['古装', '现代', '仙侠', '国风'] as const;
export const PROMPT_STYLES = ['真人写实', '动漫', '插画'] as const;

export function templateDimensions(title: string, metadata = '') {
  const text = `${title} ${metadata}`.toLowerCase();
  const tasks: PromptTask[] = [];
  if (/换装|try.on|outfit.change/.test(text)) tasks.push('outfit');
  if (/电商|商品|男装展示|女装展示|commerce|product/.test(text)) tasks.push('commerce');
  if (/ugc|随拍|手机自拍/.test(text)) tasks.push('ugc');
  if (/写真|portrait/.test(text)) tasks.push('portrait');
  if (!tasks.length || /角色设计|角色模板/.test(text)) tasks.push('character');
  return {
    tasks,
    topics: PROMPT_TOPICS.filter(topic => topic === '古装' ? /古装|古风|汉服|魏晋|唐制|宋制|明风|武侠/.test(text) : text.includes(topic)),
    styles: PROMPT_STYLES.filter(style => style === '真人写实' ? /写实|真人|摄影|photoreal/.test(text) : style === '动漫' ? /动漫|二次元|国漫|anime/.test(text) : /插画|illustration/.test(text)),
  };
}

/** A discovery subtype, independent of topic and rendering style. */
export function characterTemplateKind(title: string, categories: readonly string[] = []): 'design' | 'expression' {
  return categories.includes('expression-template') || /^角色表情\s*[·：:]/.test(title) ? 'expression' : 'design';
}
