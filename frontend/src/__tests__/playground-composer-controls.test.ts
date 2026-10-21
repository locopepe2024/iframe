import { describe, expect, it } from 'vitest';
import {
  getModelAudioControl,
  getModelCapabilities,
  getModelDuration,
  getModelParams,
  getModelRatioOptions,
  getModelsForMode,
  installUniArtCatalog,
} from '@/components/modules/playground/playgroundModels';

describe('playground composer catalog controls', () => {
  it('uses the selected SKU capabilities for creation methods', () => {
    expect(getModelCapabilities('uniart/minimax-h3-vip')).toEqual(['t2v', 'i2v', 'r2v', 'f2v']);
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
    expect(getModelAudioControl('uniart/minimax-h3-vip')).toBe('audio');
    expect(getModelAudioControl('pixverse-c1-i2v')).toBeNull();
  });

  it('replaces legacy playground choices with the live UniArt catalog', () => {
    installUniArtCatalog([
      {
        id: 'uniart/seedance-2.5-vip', api_model_id: 'seedance-2.5-vip', display_name: 'Seedance 2.5 VIP', description: '', family: 'seedance', provider: 'uniart',
        capabilities: ['t2v', 'i2v', 'r2v', 'f2v'], duration: { type: 'slider', min: 4, max: 30, step: 1, default: 4 },
        params: { resolution: { options: ['480p', '720p', '1080p'], default: '720p' }, ratio: { options: ['16:9', '9:16', '1:1'], default: '16:9' }, ratiosByResolution: { '1080p': ['16:9', '9:16', '1:1'] }, audio: true }, inputs: {},
      },
      {
        id: 'uniart/minimax-h3-vip', api_model_id: 'minimax-h3-vip', display_name: 'Minimax H3 VIP', description: '', family: 'minimax', provider: 'uniart',
        capabilities: ['t2v', 'i2v', 'r2v', 'f2v'], duration: { type: 'slider', min: 4, max: 15, step: 1, default: 15 },
        params: { resolution: { options: ['720p', '2k'], default: '2k' }, ratio: { options: ['16:9', '9:16'], default: '16:9' }, audio: false }, inputs: {},
      },
      {
        id: 'uniart/gpt-image-2.5-sunburst-special', api_model_id: 'gpt-image-2.5-sunburst-special', display_name: 'GPT Image 2.5 Sunburst Special', description: '', family: 'gpt-image', provider: 'uniart',
        capabilities: ['t2i', 'i2i'], duration: null, params: { size: { options: ['1k', '2k', '4k'], default: '1k' } }, inputs: {},
      },
    ]);

    expect(getModelsForMode('t2v').map((model) => model.id)).toEqual([
      'uniart/seedance-2.5-vip',
      'uniart/minimax-h3-vip',
    ]);
    expect(getModelsForMode('t2v').some((model) => model.family === 'happyhorse')).toBe(false);
    expect(getModelCapabilities('uniart/seedance-2.5-vip')).toEqual(['t2v', 'i2v', 'r2v', 'f2v']);
    expect(getModelDuration('uniart/seedance-2.5-vip')).toMatchObject({ min: 4, max: 30 });
    expect(getModelRatioOptions('uniart/seedance-2.5-vip', '1080p')).toEqual(['16:9', '9:16', '1:1']);
    expect(getModelAudioControl('uniart/seedance-2.5-vip')).toBe('audio');
    expect(getModelsForMode('t2i').map((model) => model.id)).toContain('uniart/gpt-image-2.5-sunburst-special');
  });
});
