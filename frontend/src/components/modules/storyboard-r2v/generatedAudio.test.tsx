import { expect, it, vi } from 'vitest';
import { storyboardGeneratedAudio } from './generatedAudio';
import { api } from '@/lib/api';
import axios from 'axios';

vi.mock('@/lib/modelCatalog', () => ({
    DEFAULT_I2V_MODEL_ID: 'supported',
    VIDEO_I2V_MODELS: [{ id: 'supported', params: { audio: true } }, { id: 'silent', params: {} }],
    VIDEO_R2V_MODELS: [{ id: 'reference', params: { audio: true } }],
}));
vi.mock('axios', () => ({ default: { post: vi.fn().mockResolvedValue({ data: [] }) } }));

it.each(['supported', 'reference'])('serializes audio on and off for %s', async (model) => {
    for (const enabled of [true, false]) {
        await api.createVideoTask('project', '', 'prompt', 5, undefined, '720p', storyboardGeneratedAudio(model, enabled));
        expect(axios.post).toHaveBeenLastCalledWith(expect.stringContaining('/video_tasks'), expect.objectContaining({ generate_audio: enabled }));
    }
});
it.each(['silent', 'missing'])('blocks inherited enabled audio for %s', (model) => {
    expect(storyboardGeneratedAudio(model, true)).toBe(false);
});
