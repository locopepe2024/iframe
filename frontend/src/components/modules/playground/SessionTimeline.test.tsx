import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { agentRequest, knowledgeRequest } from '@/lib/api';
import SessionTimeline, { mergeTimeline } from './SessionTimeline';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./ResultCard', () => ({ default: ({ generation, onRetry }: { generation: PlaygroundGeneration; onRetry?: (g: PlaygroundGeneration) => void }) => <button onClick={() => onRetry?.(generation)}>重试</button> }));
vi.mock('@/lib/api', () => ({ API_URL: 'https://garage.uniart.fun', agentRequest: vi.fn(), knowledgeRequest: vi.fn(), playgroundApi: {} }));

it('orders chat and media by time and keeps legacy chat order', () => {
  const generation = { id: 'image', created_at: new Date(2000).toISOString() } as PlaygroundGeneration;
  expect(mergeTimeline([generation], [
    { id: 'reply', role: 'assistant', content: 'done', created_at: 3 },
    { id: 'old', role: 'user', content: 'old' },
    { id: 'prompt', role: 'user', content: 'draw', created_at: 1 },
  ]).map(x => x.id)).toEqual(['old', 'prompt', 'image', 'reply']);
});
it('restores prompt and reference names and exposes message deletion', () => {
  usePlaygroundStore.setState({ history: [], inputMedia: [], mediaNames: {}, prompt: '' });
  const remove = vi.fn();
  render(<SessionTimeline onDeleteMessage={remove} messages={[{ id: 'reply', role: 'assistant', content: '让 @reference.png 跳舞', input_media: ['/playground/input-media/a.png'], asset_names: ['reference.png'], created_at: 3 }]} />);
  fireEvent.click(screen.getByRole('button', { name: '填入输入框' }));
  expect(usePlaygroundStore.getState().prompt).toBe('让 @reference.png 跳舞');
  expect(usePlaygroundStore.getState().inputMedia).toEqual(['/playground/input-media/a.png']);
  fireEvent.click(screen.getByRole('button', { name: '消息操作' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
  expect(remove).toHaveBeenCalledWith('reply');
});

const failedGeneration: PlaygroundGeneration = {
  id: 'failed-image', session_id: 'original-session', mode: 'i2i', model_id: 'uniart/gpt-image-2',
  prompt: 'edit original', negative_prompt: 'blur', input_media: ['reference.png'],
  media_names: { 'reference.png': 'Original reference' }, parameters: { size: '2k' }, batch_size: 2,
  outputs: [], status: 'failed', created_at: new Date(2000).toISOString(),
};

it('retries the original generation through the submission queue without overwriting the draft', () => {
  usePlaygroundStore.setState({ history: [failedGeneration], queue: [], activeSessionId: 'other-session', prompt: 'unsent draft' });
  render(<SessionTimeline messages={[]} />);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(usePlaygroundStore.getState().queue).toEqual([expect.objectContaining({
    mode: 'i2i', modelId: failedGeneration.model_id, prompt: failedGeneration.prompt,
    negativePrompt: 'blur', inputMedia: ['reference.png'], mediaNames: failedGeneration.media_names,
    parameters: { size: '2k' }, batchSize: 2, sessionId: 'original-session',
    parentGenerationId: 'failed-image', status: 'pending',
  })]);
  expect(usePlaygroundStore.getState().prompt).toBe('unsent draft');
});

it('keeps edit-and-continue as draft restoration without submitting', () => {
  usePlaygroundStore.setState({ history: [failedGeneration], queue: [] });
  render(<SessionTimeline messages={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'editContinue' }));
  expect(usePlaygroundStore.getState().prompt).toBe('edit original');
  expect(usePlaygroundStore.getState().queue).toEqual([]);
});

it('reports a missing session instead of silently ignoring retry', () => {
  usePlaygroundStore.setState({ history: [{ ...failedGeneration, session_id: undefined }], activeSessionId: null, queue: [] });
  render(<SessionTimeline messages={[]} />);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(screen.getByRole('alert')).toHaveTextContent('当前会话不可用');
  expect(usePlaygroundStore.getState().queue).toEqual([]);
});

it('shows discovery leads and submits only selected sources', async () => {
  usePlaygroundStore.setState({ history: [], activeSessionId: 'session-a' });
  vi.mocked(knowledgeRequest).mockResolvedValue({ id: 'run-a', status: 'awaiting_selection',
    candidates: [{ url: 'https://example.org/a', title: 'Article A', publisher: 'Example', seen_at: '20260301', published_at: null, access_status: 'public' }], jobs: [] });
  render(<SessionTimeline messages={[{ id: 'm', role: 'assistant', content: '候选来源', research_run_id: 'run-a' }]} />);
  await screen.findByText('Article A');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '采集所选来源' }));
  await waitFor(() => expect(vi.mocked(knowledgeRequest)).toHaveBeenCalledWith('/research/run-a/sources', 'POST', { urls: ['https://example.org/a'] }));
});

it('requests one cited answer after a durable run is ready', async () => {
  usePlaygroundStore.setState({ history: [], activeSessionId: 'session-a' });
  vi.mocked(knowledgeRequest).mockResolvedValue({ id: 'run-b', status: 'ready', candidates: [], jobs: [] });
  vi.mocked(agentRequest).mockResolvedValue({ assistant_message: { id: 'answer' } });
  render(<SessionTimeline messages={[{ id: 'm', role: 'assistant', content: '采集中', research_run_id: 'run-b' }]} />);
  await waitFor(() => expect(vi.mocked(agentRequest)).toHaveBeenCalledWith('/sessions/playground-session-a/research/run-b/answer', 'POST'));
  expect(vi.mocked(agentRequest)).toHaveBeenCalledTimes(1);
});
