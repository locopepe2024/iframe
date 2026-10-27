import catalog from './openAiCanvasPrompts.json';
import type { PromptTask } from './promptTemplateCategories';
const tasks: Record<string, PromptTask> = { style: 'visual-style', motion: 'camera-motion', nine_grid: 'multi-view' };
const scopes: Record<string, string> = {
  style: '视觉风格 · 按需加入，不替换角色身份与外观',
  motion: '视频／分镜运镜 · 用于运动镜头，不是静态角色特征',
  nine_grid: '多视图与推演 · 需要在提交时另行选择来源参考图',
};
/** Text-only snapshot; does not fetch media or change generation settings. */
export const OPEN_AI_CANVAS_PROMPTS = catalog.entries.map(item => ({
  id: item.id, title: item.title, text: item.prompt, type: 'Prompt 模板' as const,
  categories: [item.kind], domain: scopes[item.kind],
  source: `Open AI Canvas · ${catalog.provenance.revision.slice(0, 8)} · MIT`,
  search: `${item.title} ${item.key} ${item.tag} ${item.description} ${item.kind === 'style' ? '风格' : item.kind === 'motion' ? '运镜' : '九宫格 多视图 推演'}`,
  promptTask: tasks[item.kind], promptTag: item.tag,
  usageHint: `${scopes[item.kind]}${item.ratio ? `；原模板画幅：${item.ratio === 'original' ? '跟随来源图' : item.ratio}（请自行设置出图画幅）` : ''}`,
  editableText: true,
}));
