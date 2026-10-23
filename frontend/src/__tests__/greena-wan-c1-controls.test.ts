import { expect, it } from 'vitest';
import { getModelDuration, getModelParams, getModelsForMode, installUniArtCatalog } from '@/components/modules/playground/playgroundModels';
import { usePlaygroundStore } from '@/components/modules/playground/usePlaygroundStore';

it('uses the GreenA runtime catalog in four modes and submits the displayed resolution', () => {
  installUniArtCatalog([{
    id: 'nsfw/wan3.0', api_model_id: 'wan3.0', display_name: 'Wan3.0', description: '', family: 'wan', provider: 'nsfw',
    capabilities: ['t2v','i2v','f2v','r2v'], duration: {type:'slider', min:2, max:30, step:1, default:5},
    params: {resolution:{options:['480p','720p','1080p'],default:'1080p'},ratio:{options:['adaptive','21:9','16:9','4:3','1:1','3:4','9:16'],default:'adaptive'}},
    inputs: {reference_images:{max:10},reference_videos:{max:1},reference_audios:{max:5}},
  }]);
  for (const mode of ['t2v','i2v','f2v','r2v'] as const) {
    expect(getModelsForMode(mode)).toMatchObject([{id:'nsfw/wan3.0',maxReferenceImages:10,maxReferenceVideos:1,maxReferenceAudios:5}]);
  }
  expect(getModelDuration('nsfw/wan3.0')).toEqual({type:'slider',min:2,max:30,step:1,default:5});
  expect(getModelParams('nsfw/wan3.0')?.ratio?.default).toBe('adaptive');
  usePlaygroundStore.setState({queue:[]});
  usePlaygroundStore.getState().enqueueRequest({mode:'t2v',modelId:'nsfw/wan3.0',prompt:'test',inputMedia:[],mediaNames:{},parameters:{duration:2,aspect_ratio:'adaptive'},batchSize:1,sessionId:'s'});
  expect(usePlaygroundStore.getState().queue[0].parameters).toEqual({duration:2,aspect_ratio:'adaptive',resolution:'1080p'});
});
