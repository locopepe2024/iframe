import { describe, expect, it } from 'vitest';
import { getOutputAspectRatio } from '@/components/modules/playground/mediaDisplay';

describe('getOutputAspectRatio', () => {
  it.each([
    ['16:9', '16 / 9'],
    ['9:16', '9 / 16'],
    ['4:3', '4 / 3'],
    ['3/4', '3 / 4'],
  ])('normalizes %s', (ratio, expected) => {
    expect(getOutputAspectRatio({ ratio })).toBe(expected);
  });

  it('accepts aspect_ratio and falls back for malformed values', () => {
    expect(getOutputAspectRatio({ aspect_ratio: '9:16' })).toBe('9 / 16');
    expect(getOutputAspectRatio({ ratio: 'square' })).toBe('16 / 9');
  });
});
