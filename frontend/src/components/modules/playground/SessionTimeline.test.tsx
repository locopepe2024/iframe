import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SessionTimeline, { mergeTimeline } from './SessionTimeline';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./ResultCard', () => ({ default: () => <div>Media result</div> }));

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
