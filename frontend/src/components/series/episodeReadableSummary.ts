import type { DirectorProfile } from '@/store/projectStore';

function eventText(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function sentence(value: string): string {
  return value.replace(/[。.!！]+$/, '');
}

export function episodeReadableSummary(profile: DirectorProfile | null | undefined): string {
  if (!profile) return '';
  const phases = profile.story_map?.phases || [];
  const storyEvents = [...phases].sort((a, b) => a.order - b.order)
    .flatMap(phase => [...phase.events].sort((a, b) => a.order - b.order))
    .map(event => event.description || event.title);
  const timelineEvents = [...(profile.timeline || [])]
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map(item => eventText(item, ['event', 'description', 'change', 'summary']));
  const keyEvents = (profile.key_events || [])
    .map(item => eventText(item, ['event', 'description', 'summary', 'function']));
  const events = [storyEvents, timelineEvents, keyEvents]
    .find(candidates => candidates.some(value => typeof value === 'string' && value.trim())) || [];
  const sentences = events.filter((value): value is string => typeof value === 'string' && !!value.trim()).map(sentence);
  if (!sentences.length) return '';
  const setting = profile.setting || {};
  const context = ['season_time', 'primary_location']
    .map(key => setting[key]).filter((value): value is string => typeof value === 'string' && !!value.trim())
    .join('，');
  return `${context ? `${sentence(context)}。` : ''}${sentences.join('。')}。`;
}
