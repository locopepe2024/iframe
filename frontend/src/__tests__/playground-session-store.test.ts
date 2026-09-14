import { beforeEach, describe, expect, it } from 'vitest';
import { usePlaygroundStore, type PlaygroundGeneration, type PlaygroundSession } from '@/components/modules/playground/usePlaygroundStore';
import { getDefaultModeForOutput, getOutputType } from '@/components/modules/playground/ModeSelector';

const session: PlaygroundSession = {
  id: 'session-1',
  title: '雨夜追逐',
  draft: {
    mode: 'i2v',
    model_id: 'video-model',
    prompt: '雨夜中的追逐镜头',
    negative_prompt: '模糊',
    input_media: ['output/reference.png'],
    parameters: { ratio: '16:9', duration: 5 },
    batch_size: 2,
    parent_generation_id: 'generation-parent',
  },
  created_at: '2026-09-14T00:00:00Z',
  updated_at: '2026-09-14T00:00:00Z',
};

const generation: PlaygroundGeneration = {
  id: 'generation-1',
  session_id: 'session-1',
  parent_generation_id: 'generation-parent',
  mode: 'r2v',
  model_id: 'reference-video-model',
  prompt: '延续角色动作并切到近景',
  negative_prompt: '字幕',
  input_media: ['output/character.png', 'output/action.mp4'],
  parameters: { ratio: '9:16', duration: 10 },
  batch_size: 1,
  outputs: [],
  status: 'completed',
  created_at: '2026-09-14T01:00:00Z',
};

describe('playground session store', () => {
  beforeEach(() => {
    usePlaygroundStore.setState({
      sessions: [],
      activeSessionId: null,
      parentGenerationId: null,
      history: [],
      activeGenerationIds: [],
      isGenerating: false,
      mode: 't2i',
      modelId: '',
      prompt: '',
      negativePrompt: '',
      inputMedia: [],
      parameters: {},
      batchSize: 1,
    });
  });

  it('switches session and applies its complete draft', () => {
    const store = usePlaygroundStore.getState();
    store.setSessions([session]);
    store.setActiveSession(session.id);
    store.applySessionDraft(session.draft);

    const state = usePlaygroundStore.getState();
    expect(state.activeSessionId).toBe('session-1');
    expect(state.mode).toBe('i2v');
    expect(state.modelId).toBe('video-model');
    expect(state.prompt).toBe('雨夜中的追逐镜头');
    expect(state.inputMedia).toEqual(['output/reference.png']);
    expect(state.parameters).toEqual({ ratio: '16:9', duration: 5 });
    expect(state.parentGenerationId).toBe('generation-parent');
  });

  it('restores a historical generation as an editable branch source', () => {
    usePlaygroundStore.getState().restoreGeneration(generation);
    const state = usePlaygroundStore.getState();

    expect(state.mode).toBe('r2v');
    expect(state.modelId).toBe('reference-video-model');
    expect(state.prompt).toBe('延续角色动作并切到近景');
    expect(state.negativePrompt).toBe('字幕');
    expect(state.inputMedia).toEqual(['output/character.png', 'output/action.mp4']);
    expect(state.parameters).toEqual({ ratio: '9:16', duration: 10 });
    expect(state.parentGenerationId).toBe('generation-1');
  });

  it('hydrates active generation ids from pending history', () => {
    usePlaygroundStore.getState().setHistory([
      { ...generation, id: 'pending-1', status: 'processing' },
      generation,
    ]);
    const state = usePlaygroundStore.getState();
    expect(state.activeGenerationIds).toEqual(['pending-1']);
    expect(state.isGenerating).toBe(true);
  });

  it('maps the global output selector onto existing playground modes', () => {
    expect(getOutputType('t2i')).toBe('image');
    expect(getOutputType('i2i')).toBe('image');
    expect(getOutputType('t2v')).toBe('video');
    expect(getOutputType('r2v')).toBe('video');
    expect(getDefaultModeForOutput('image')).toBe('t2i');
    expect(getDefaultModeForOutput('video')).toBe('t2v');
  });
});
