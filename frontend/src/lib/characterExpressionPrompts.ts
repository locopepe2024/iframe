import type { CharacterDictionaryPreset } from './characterDictionaryPresets';

/** Static performance cues; never identity morphology or a timed micro-expression. */
export const EXPRESSION_DETAIL_GROUPS = [
  ['expression-brow-state', '眉部表现', [
    ['眉头放松', '眉头自然放松'], ['眉头轻蹙', '眉头轻微聚拢'],
    ['眉头下压', '眉头下压，眉间略紧'], ['眉内侧上扬', '眉毛内侧略微上扬'],
    ['单侧挑眉', '一侧眉毛轻轻挑起'], ['双眉上扬', '双眉略微上扬'],
  ]],
  ['expression-lid-state', '眼睑表现', [
    ['眼睑放松', '眼睑自然放松'], ['眼睛微弯', '眼睛略微弯起'],
    ['眼睑略收紧', '下眼睑略微收紧'], ['双眼略睁大', '双眼略微睁大'],
    ['眼里含泪', '眼眶湿润，泪未落'], ['眼睑半垂', '眼睑自然半垂'],
    ['笑时眼角细纹', '微笑时眼角出现轻微褶皱'],
  ]],
  ['expression-gaze-state', '视线表现', [
    ['平静目光', '目光平静'], ['温和目光', '目光温和'],
    ['坚定目光', '目光坚定'], ['冷淡目光', '目光冷淡'],
    ['目光低垂', '目光低垂'], ['侧向目光', '目光偏向一侧'], ['失焦目光', '目光失焦'],
  ]],
  ['expression-mouth-state', '嘴部表现', [
    ['自然闭唇', '嘴唇自然闭合'], ['轻抿嘴唇', '嘴唇轻轻抿住'],
    ['闭唇浅笑', '双侧嘴角轻轻上扬，嘴唇闭合'],
    ['自然露齿笑', '嘴角自然上扬，嘴唇张开，露出部分上排牙齿'],
    ['张口大笑', '双侧嘴角明显上扬，嘴巴自然张开，呈大笑表情'],
    ['单侧嘴角上扬', '一侧嘴角轻轻上扬'], ['嘴角下垂', '嘴角轻微下垂'],
    ['嘴唇微张', '嘴唇微微张开'],
  ]],
  ['expression-jaw-state', '下颌状态', [
    ['下颌放松', '下颌自然放松'], ['下颌略绷紧', '下颌略微绷紧'],
  ]],
  ['expression-complexion-state', '面部气色', [
    ['面颊轻微泛红', '面颊轻微泛红'], ['眼眶略红', '眼眶略微发红'],
  ]],
] as const;

const source = '用户提供的角色词典 v1 · iFrame 静态面部表现整理';
export const CHARACTER_EXPRESSION_DETAIL_TERMS: CharacterDictionaryPreset[] = EXPRESSION_DETAIL_GROUPS.flatMap(([category, label, rows]) =>
  rows.map(([title, text], index) => ({
    id: `dictionary.${category}.${index}`, title, text, slotValue: text, type: '词条',
    categories: [category], domain: '面部表现细节', source, search: `表情 面部表现 ${label} ${title} ${text}`,
  })),
);

type ExpressionSelections = Partial<Record<typeof EXPRESSION_DETAIL_GROUPS[number][1], string>>;
const presets: { id: string; title: string; values: ExpressionSelections }[] = [
  { id: 'neutral', title: '平静中性', values: { 眉部表现: '眉头放松', 眼睑表现: '眼睑放松', 视线表现: '平静目光', 嘴部表现: '自然闭唇', 下颌状态: '下颌放松' } },
  { id: 'subtle-smile', title: '含蓄微笑', values: { 眉部表现: '眉头放松', 眼睑表现: '眼睑放松', 视线表现: '温和目光', 嘴部表现: '闭唇浅笑', 下颌状态: '下颌放松' } },
  { id: 'toothy-smile', title: '自然露齿笑', values: { 眉部表现: '眉头放松', 眼睑表现: '眼睛微弯', 视线表现: '温和目光', 嘴部表现: '自然露齿笑', 下颌状态: '下颌放松' } },
  { id: 'laugh', title: '开怀大笑', values: { 眉部表现: '眉头放松', 眼睑表现: '笑时眼角细纹', 视线表现: '温和目光', 嘴部表现: '张口大笑', 下颌状态: '下颌放松' } },
  { id: 'gentle-smile', title: '温柔笑', values: { 眉部表现: '眉头放松', 眼睑表现: '眼睛微弯', 视线表现: '温和目光', 嘴部表现: '闭唇浅笑' } },
  { id: 'smirk', title: '得意坏笑', values: { 眉部表现: '单侧挑眉', 眼睑表现: '眼睑放松', 视线表现: '侧向目光', 嘴部表现: '单侧嘴角上扬' } },
  { id: 'cold-smile', title: '不屑冷笑', values: { 眉部表现: '单侧挑眉', 眼睑表现: '眼睑半垂', 视线表现: '冷淡目光', 嘴部表现: '单侧嘴角上扬' } },
  { id: 'puzzled', title: '轻微疑惑', values: { 眉部表现: '眉头轻蹙', 眼睑表现: '眼睑略收紧', 视线表现: '侧向目光', 嘴部表现: '嘴唇微张' } },
  { id: 'surprised', title: '惊讶', values: { 眉部表现: '双眉上扬', 眼睑表现: '双眼略睁大', 嘴部表现: '嘴唇微张', 下颌状态: '下颌放松' } },
  { id: 'held-tears', title: '含泪强忍', values: { 眉部表现: '眉头轻蹙', 眼睑表现: '眼里含泪', 视线表现: '目光低垂', 嘴部表现: '轻抿嘴唇', 下颌状态: '下颌略绷紧', 面部气色: '眼眶略红' } },
  { id: 'aggrieved', title: '委屈', values: { 眉部表现: '眉内侧上扬', 眼睑表现: '眼里含泪', 视线表现: '目光低垂', 嘴部表现: '嘴角下垂' } },
  { id: 'numb', title: '麻木', values: { 眉部表现: '眉头放松', 眼睑表现: '眼睑半垂', 视线表现: '失焦目光', 嘴部表现: '嘴唇微张', 下颌状态: '下颌放松' } },
  { id: 'restrained-anger', title: '压抑怒火', values: { 眉部表现: '眉头下压', 眼睑表现: '眼睑略收紧', 视线表现: '坚定目光', 嘴部表现: '轻抿嘴唇', 下颌状态: '下颌略绷紧' } },
];

export const CHARACTER_EXPRESSION_PROMPTS: CharacterDictionaryPreset[] = presets.map(({ id, title, values }) => {
  const sections = EXPRESSION_DETAIL_GROUPS.map(([, label]) => ({ label, parts: [`[${label}]。`] }));
  return {
    id: `dictionary.template.expression.${id}`, title: `角色表情 · ${title}`,
    type: 'Prompt 模板', categories: ['expression-template'], domain: '角色表情', source,
    search: `角色设计 角色表情 静态表情 ${title}`,
    sections, text: sections.map(section => `${section.label}：${section.parts.join('')}`).join('\n'),
    defaults: values,
    fields: EXPRESSION_DETAIL_GROUPS.map(([, label, rows]) => ({
      key: label, label, value: values[label] ?? '',
      options: ['', ...rows.map(([name]) => name), `[${label}]`],
      output: Object.fromEntries(rows),
    })),
  };
});
