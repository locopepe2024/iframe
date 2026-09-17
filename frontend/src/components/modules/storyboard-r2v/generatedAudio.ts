import { VIDEO_I2V_MODELS, VIDEO_R2V_MODELS } from '@/lib/modelCatalog';

/** Never carry an enabled flag into a model that cannot control audio. */
export function storyboardGeneratedAudio(modelId: string, enabled?: boolean): boolean {
    const model = [...VIDEO_I2V_MODELS, ...VIDEO_R2V_MODELS].find(model => model.id === modelId);
    return model?.params.audio === true && enabled === true;
}
