export const CHARACTER_PANEL_GROUPS: ReadonlyArray<{ id: string; label: string; panels: ReadonlyArray<readonly [string, string]> }> = [
  { id: 'identity', label: '基础身份', panels: [
    ['dictionary.panel.basic', '基础特征'],
  ] },
  { id: 'appearance', label: '面容与身体', panels: [
    ['dictionary.panel.face', '面容'],
    ['dictionary.panel.skin', '肤色与肤质'],
    ['dictionary.panel.hair', '发型'],
    ['dictionary.panel.posture', '体态'],
  ] },
  { id: 'outfit', label: '服装搭配', panels: [
    ['dictionary.panel.classical-robe', '古装外套'],
    ['dictionary.panel.classical-skirt', '古装衣裙'],
    ['dictionary.panel.modern-male-clothing', '现代男装'],
    ['dictionary.panel.modern-clothing', '现代女装'],
  ] },
  { id: 'detail', label: '服饰细节', panels: [
    ['dictionary.panel.classical-footwear', '古装鞋履'],
    ['dictionary.panel.jewelry', '首饰'],
    ['dictionary.panel.decoration', '配饰'],
    ['dictionary.panel.condition', '新旧'],
  ] },
  { id: 'performance', label: '表演', panels: [
    ['dictionary.panel.expression', '表情'],
  ] },
];

export const CHARACTER_PANEL_LABELS: Record<string, string> = Object.fromEntries(
  CHARACTER_PANEL_GROUPS.flatMap((group) => group.panels),
);

export const CHARACTER_PANEL_ORDER: string[] = CHARACTER_PANEL_GROUPS.flatMap((group) => group.panels.map(([id]) => id));

export function characterPanelGroup(id: string): string | null {
  return CHARACTER_PANEL_GROUPS.find((group) => group.panels.some(([panelId]) => panelId === id))?.id || null;
}
