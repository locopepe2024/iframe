import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SessionTimeline, { mergeTimeline } from './SessionTimeline';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./ResultCard', () => ({ default: ({ generation, onRetry }: { generation: PlaygroundGeneration; onRetry?: (g: PlaygroundGeneration) => void }) => <button onClick={() => onRetry?.(generation)}>重试</button> }));

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
