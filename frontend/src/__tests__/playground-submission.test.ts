import { beforeEach, describe, expect, it } from 'vitest';
import { normalizePlaygroundSubmission } from '@/components/modules/playground/playgroundSubmission';
import { usePlaygroundStore } from '@/components/modules/playground/usePlaygroundStore';

describe('playground image request mode boundary', () => {
  beforeEach(() => {
    usePlaygroundStore.setState({
      mode: 'i2i',
      inputMedia: ['/old-reference.png'],
      mediaNames: { '/old-reference.png': 'old-reference.png' },
    });
  });

  it('keeps text-to-image as generation and drops stale references', () => {
    const inputMedia = ['/old-reference.png'];
    const submission = normalizePlaygroundSubmission('t2i', inputMedia, '新图片');

    expect(submission).toEqual({ mode: 't2i', inputMedia: [], prompt: '新图片' });
    expect(inputMedia).toEqual(['/old-reference.png']);
  });

  it('preserves references for explicit image editing and snapshots the list', () => {
    const inputMedia = ['/reference.png'];
    const submission = normalizePlaygroundSubmission('i2i', inputMedia, '@1 修改');

    expect(submission).toEqual({ mode: 'i2i', inputMedia: ['/reference.png'], prompt: '@1 修改' });
    expect(submission.inputMedia).not.toBe(inputMedia);
  });

  it('clears old references when the user selects text-to-image', () => {
    usePlaygroundStore.getState().setMode('t2i');

    expect(usePlaygroundStore.getState()).toMatchObject({
      mode: 't2i',
      inputMedia: [],
      mediaNames: {},
    });
  });

  it('does not restore references from a legacy t2i draft', () => {
    usePlaygroundStore.getState().applySessionDraft({
      mode: 't2i',
      model_id: 'uniart/gpt-image-2',
      prompt: 'new image',
      input_media: ['/legacy-reference.png'],
      media_names: { '/legacy-reference.png': 'legacy-reference.png' },
      parameters: {},
      batch_size: 1,
    });

    expect(usePlaygroundStore.getState()).toMatchObject({
      mode: 't2i',
      inputMedia: [],
      mediaNames: {},
    });
  });
});

for (const mode of ['t2i', 'i2i', 't2v', 'i2v', 'r2v', 'f2v', 'v2v'] as const) {
  it(`omits unmentioned selected media for ${mode}`, () => {
    const candidates = ['/missing.png'];
    expect(normalizePlaygroundSubmission(mode, candidates, '纯文字')).toEqual({ mode, inputMedia: [], prompt: '纯文字' });
    expect(candidates).toEqual(['/missing.png']);
  });
}

describe('selected candidates versus submitted references', () => {
  const candidates = Array.from({ length: 7 }, (_, i) => `/playground/input-media/${i + 1}.png`);
  const names = Object.fromEntries(candidates.map((p, i) => [p, `reference-${i + 1}.png`]));

  it('submits only two named references from seven candidates and retains display names', () => {
    const prompt = '@reference-2.png 与 @reference-4.png，@reference-2.png 保持外观';
    expect(normalizePlaygroundSubmission('i2i', candidates, prompt, names)).toEqual({
      mode: 'i2i', inputMedia: [candidates[1], candidates[3]], prompt,
    });
    expect(candidates).toHaveLength(7);
  });

  it('rebases explicit indices after removing unused candidates', () => {
    expect(normalizePlaygroundSubmission('r2v', candidates, '从 @7 到 @2，再 @7', names)).toEqual({
      mode: 'r2v', inputMedia: [candidates[1], candidates[6]], prompt: '从 @2 到 @1，再 @2',
    });
  });

  it('does not treat a filename prefix or unrelated @ as attachment consent', () => {
    expect(normalizePlaygroundSubmission('i2i', candidates, '@reference-2.png.backup @提醒', names).inputMedia).toEqual([]);
  });

  it('keeps filenames intact while rebasing numeric references', () => {
    expect(normalizePlaygroundSubmission('i2i', candidates, '@reference-4.png 与 @7', names)).toEqual({
      mode: 'i2i', inputMedia: [candidates[3], candidates[6]], prompt: '@reference-4.png 与 @2',
    });
  });

  it('keeps ambiguous names for server rejection instead of silently selecting one', () => {
    const duplicateNames = { [candidates[1]]: 'portrait.png', [candidates[3]]: 'portrait.png' };
    expect(normalizePlaygroundSubmission('i2i', candidates, '@portrait.png', duplicateNames).inputMedia)
      .toEqual([candidates[1], candidates[3]]);
    expect(normalizePlaygroundSubmission('i2i', candidates, '@refer...', names).inputMedia).toEqual(candidates);
  });
});
