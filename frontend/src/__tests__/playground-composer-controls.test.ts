import { describe, expect, it } from 'vitest';
import {
  getModelAudioControl,
  getModelCapabilities,
  getModelParams,
} from '@/components/modules/playground/playgroundModels';

describe('playground composer catalog controls', () => {
  it('uses the selected SKU capabilities for creation methods', () => {
    expect(getModelCapabilities('uniart/minimax-h3-vip')).toEqual(['t2v', 'i2v', 'r2v']);
    expect(getModelCapabilities('uniart/gpt-image-2')).toEqual(['t2i', 'i2i']);
  });

  it('keeps UniArt ratio values as catalog strings', () => {
    expect(getModelParams('uniart/minimax-h3-vip')?.ratio).toEqual({
      default: '16:9',
      options: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    });
  });

  it('only exposes audio when the active adapter consumes the catalog parameter', () => {
    expect(getModelAudioControl('kling-v3-i2v')).toBe('sound');
    expect(getModelAudioControl('uniart/minimax-h3-vip')).toBeNull();
    expect(getModelAudioControl('pixverse-c1-i2v')).toBeNull();
  });
});
