export const COMPANION_SKILLS = [
  {
    id: 'memory',
    title: '记忆与画像',
  },
  {
    id: 'listening',
    title: '倾听与话题引导',
  },
  {
    id: 'schedule',
    title: '日程与备忘',
  },
  {
    id: 'cognition',
    title: '认知与娱乐',
  },
] as const;

export type CompanionSkillId = (typeof COMPANION_SKILLS)[number]['id'];
export const COMPANION_SKILLS_STORAGE_KEY = 'iframe.agent-companion-skills.v1';

export function readCompanionSkills(storage: Pick<Storage, 'getItem'>): CompanionSkillId[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(COMPANION_SKILLS_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return COMPANION_SKILLS.map((skill) => skill.id).filter((id) => value.includes(id));
  } catch {
    return [];
  }
}
