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
    const submission = normalizePlaygroundSubmission('t2i', inputMedia);

    expect(submission).toEqual({ mode: 't2i', inputMedia: [] });
    expect(inputMedia).toEqual(['/old-reference.png']);
  });

  it('preserves references for explicit image editing and snapshots the list', () => {
    const inputMedia = ['/reference.png'];
    const submission = normalizePlaygroundSubmission('i2i', inputMedia);

    expect(submission).toEqual({ mode: 'i2i', inputMedia: ['/reference.png'] });
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
