import { describe, expect, it } from 'vitest';
import { IDENTITY_FIELDS, characterSectionText, normalizeCharacterFeatures } from '@/lib/characterStructuredDesign';

const keys = IDENTITY_FIELDS.map(([key]) => key);

describe('character structured prompt projection', () => {
  it('uses ordered structured fields without duplicating the legacy summary', () => {
    const features = normalizeCharacterFeatures({ build: '宽肩长腿', face: '窄长脸', extra: '不应出现' }, keys);
    expect(characterSectionText(features, keys, '窄长脸，宽肩长腿')).toBe('窄长脸；宽肩长腿');
  });

  it('preserves legacy drafts when no structured values exist', () => {
    expect(characterSectionText({}, keys, '深棕眼，黑发束起')).toBe('深棕眼，黑发束起');
  });
});
