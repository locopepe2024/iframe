import { expect, it } from 'vitest';
import { transcriptDraft } from './transcriptDraft';

it('keeps all recognized text in ordered estimated cues within the selected clip', () => {
  const cues = transcriptDraft('第一句。第二句！', 1000, 3000);
  expect(cues.map(cue => cue.text)).toEqual(['第一句。', '第二句！']);
  expect(cues[0].start_ms).toBe(1000);
  expect(cues.at(-1)?.end_ms).toBe(3000);
  expect(cues.every((cue, index) => cue.end_ms > cue.start_ms && (index === 0 || cue.start_ms >= cues[index - 1].end_ms))).toBe(true);
});

it('rejects text that cannot fit valid cues instead of dropping recognized words', () => {
  expect(transcriptDraft('a.b.', 0, 1)).toEqual([]);
  expect(transcriptDraft('a.'.repeat(257), 0, 60000)).toEqual([]);
  expect(transcriptDraft('   ', 0, 1000)).toEqual([]);
});

it('keeps surrogate pairs intact when splitting long lines', () => {
  const cues = transcriptDraft('😀'.repeat(61), 0, 1000);
  expect(cues.map(cue => cue.text)).toEqual(['😀'.repeat(60), '😀']);
});
