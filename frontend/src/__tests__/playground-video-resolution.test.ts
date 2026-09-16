import { expect, it } from 'vitest';
import { installUniArtCatalog } from '@/components/modules/playground/playgroundModels';
import { usePlaygroundStore } from '@/components/modules/playground/usePlaygroundStore';

it.each(['480p', '720p'])('submits the displayed %s catalog default without requiring a click', (resolution) => {
  installUniArtCatalog([{
    id: 'uniart/seedance-2.5-special', api_model_id: 'seedance-2.5-special', display_name: 'Seedance',
    description: '', family: 'seedance', provider: 'uniart', capabilities: ['i2v'], duration: null,
    params: { resolution: { options: ['480p', '720p', '1080p'], default: resolution } }, inputs: {},
  }]);
  usePlaygroundStore.setState({ queue: [] });
  const request = { mode: 'i2v' as const, modelId: 'uniart/seedance-2.5-special', prompt: 'walk', inputMedia: [],
    mediaNames: {}, parameters: { duration: 10 }, batchSize: 1, sessionId: 's' };
  usePlaygroundStore.getState().enqueueRequest(request);
  expect(usePlaygroundStore.getState().queue[0].parameters).toEqual({ duration: 10, resolution });
  usePlaygroundStore.getState().enqueueRequest({ ...request, parameters: { ...request.parameters, resolution: '480p' } });
  expect(usePlaygroundStore.getState().queue[1].parameters.resolution).toBe('480p');
  expect(request.parameters).toEqual({ duration: 10 });
});
