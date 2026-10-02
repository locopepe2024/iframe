import { describe, expect, it } from 'vitest';
import { getOutputAspectRatio } from '@/components/modules/playground/mediaDisplay';

describe('playground output aspect ratio', () => {
  it.each([
    ['16:9', '16 / 9'],
    ['9:16', '9 / 16'],
    ['4:3', '4 / 3'],
    ['3:4', '3 / 4'],
  ])('maps %s to CSS aspect ratio', (ratio, expected) => {
    expect(getOutputAspectRatio({ ratio })).toBe(expected);
  });

  it('accepts aspect_ratio and falls back for invalid values', () => {
    expect(getOutputAspectRatio({ aspect_ratio: '9/16' })).toBe('9 / 16');
    expect(getOutputAspectRatio({ ratio: 'portrait' })).toBe('16 / 9');
  });
});
