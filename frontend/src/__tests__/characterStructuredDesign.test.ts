import { describe, expect, it } from 'vitest';
import { IDENTITY_FIELDS, characterSectionText, normalizeCharacterFeatures } from '@/lib/characterStructuredDesign';

const keys = IDENTITY_FIELDS.map(([key]) => key);

describe('character structured prompt projection', () => {
  it('retains independent facial anatomy when reopening and projecting a saved design', () => {
    const saved = { face_shape: '圆脸', forehead: '额头饱满', cheekbones: '颧骨平缓', jaw: '下颌轮廓分明', chin: '下巴圆润' };
    const features = normalizeCharacterFeatures(JSON.parse(JSON.stringify(saved)), keys);
    expect(features).toEqual(saved);
    expect(characterSectionText(features, keys, '旧摘要')).toBe('圆脸；额头饱满；颧骨平缓；下颌轮廓分明；下巴圆润');
  });
  it('uses ordered structured fields without duplicating the legacy summary', () => {
    const features = normalizeCharacterFeatures({ build: '宽肩长腿', face: '窄长脸', extra: '不应出现' }, keys);
    expect(characterSectionText(features, keys, '窄长脸，宽肩长腿')).toBe('窄长脸；宽肩长腿');
  });

  it('preserves legacy drafts when no structured values exist', () => {
    expect(characterSectionText({}, keys, '深棕眼，黑发束起')).toBe('深棕眼，黑发束起');
  });

  it('projects the selected editor mode while retaining the other draft', () => {
    const features = { face: '窄长脸' };
    expect(characterSectionText(features, keys, '自然面部不对称', 'notes')).toBe('自然面部不对称');
    expect(characterSectionText(features, keys, '自然面部不对称', 'fields')).toBe('窄长脸');
  });
});
