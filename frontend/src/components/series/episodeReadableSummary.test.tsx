import { describe, expect, it } from 'vitest';
import type { DirectorProfile } from '@/store/projectStore';
import { episodeReadableSummary, seriesReadableContext } from './episodeReadableSummary';

describe('episode readable summary', () => {
  it('uses ordered story events and omits execution-only instructions', () => {
    const profile = {
      setting: { season_time: '暮秋残阳', primary_location: '青溪镇长街' },
      timeline: [
        { order: 2, event: '苏砚出手制服匪寇' },
        { order: 1, event: '粮铺遭劫' },
      ],
      key_events: [],
      execution_summary: '真人动漫。\nCURRENT_DIRECTOR_EDITS: GUARDRAILS: {}',
    } as unknown as DirectorProfile;

    expect(episodeReadableSummary(profile)).toBe('暮秋残阳，青溪镇长街。粮铺遭劫。苏砚出手制服匪寇。');
  });

  it('does not invent a story summary when the Director only contains style guidance', () => {
    const profile = { setting: {}, timeline: [], key_events: [], execution_summary: 'Chinese Ink Fantasy' } as unknown as DirectorProfile;
    expect(episodeReadableSummary(profile)).toBe('');
  });

  it('reads explicit series story fields without exposing the execution summary', () => {
    const profile = {
      setting: { premise: '苏砚追查旧案。', world_overview: '大靖年间的江湖。', story_summary: '苏砚追查旧案。' },
      execution_summary: 'Chinese Ink Fantasy\nCURRENT_DIRECTOR_EDITS: GUARDRAILS: {}',
    } as unknown as DirectorProfile;
    expect(seriesReadableContext(profile)).toEqual(['苏砚追查旧案。', '大靖年间的江湖。']);
    expect(seriesReadableContext({ setting: {}, execution_summary: profile.execution_summary } as DirectorProfile)).toEqual([]);
  });
});
