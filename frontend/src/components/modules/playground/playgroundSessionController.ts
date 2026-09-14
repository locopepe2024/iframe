import {
  playgroundApi,
  type PlaygroundGenerationResponse,
  type PlaygroundSessionResponse,
} from '@/lib/api';
import {
  usePlaygroundStore,
  type PlaygroundGeneration,
  type PlaygroundMode,
  type PlaygroundSession,
} from './usePlaygroundStore';

export function toPlaygroundGeneration(resp: PlaygroundGenerationResponse): PlaygroundGeneration {
  return {
    id: resp.id,
    mode: resp.mode as PlaygroundMode,
    model_id: resp.model_id,
    prompt: resp.prompt,
    negative_prompt: resp.negative_prompt,
    input_media: resp.input_media,
    parameters: resp.parameters,
    batch_size: resp.batch_size,
    outputs: resp.outputs.map((output) => ({
      ...output,
      media_type: output.media_type as 'image' | 'video',
    })),
    status: resp.status as PlaygroundGeneration['status'],
    error: resp.error,
    created_at: resp.created_at,
    session_id: resp.session_id,
    parent_generation_id: resp.parent_generation_id,
  };
}

export function toPlaygroundSession(resp: PlaygroundSessionResponse): PlaygroundSession {
  return {
    ...resp,
    draft: { ...resp.draft, mode: resp.draft.mode as PlaygroundMode },
  };
}

export async function openPlaygroundSession(session: PlaygroundSession): Promise<void> {
  const store = usePlaygroundStore.getState();
  store.setHistory([]);
  store.setActiveSession(session.id);
  store.applySessionDraft(session.draft);

  try {
    const history = (await playgroundApi.getHistory(100, 0, session.id)).map(toPlaygroundGeneration);
    if (usePlaygroundStore.getState().activeSessionId === session.id) {
      usePlaygroundStore.getState().setHistory(history);
    }
  } catch (error) {
    if (usePlaygroundStore.getState().activeSessionId === session.id) {
      usePlaygroundStore.getState().setHistory([]);
    }
    throw error;
  }
}

export async function createPlaygroundSession(): Promise<PlaygroundSession> {
  const created = toPlaygroundSession(await playgroundApi.createSession());
  usePlaygroundStore.getState().addSession(created);
  await openPlaygroundSession(created);
  return created;
}
