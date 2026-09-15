import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ResultCard from './ResultCard';
import type { PlaygroundGeneration } from './usePlaygroundStore';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ API_URL: 'https://garage.uniart.fun', playgroundApi: {} }));

it.each(['completed', 'failed', 'pending', 'processing'] as const)('deletes a %s card from its time row without opening details', (status) => {
  const generation: PlaygroundGeneration = {
    id: 'test', mode: 't2i', model_id: 'model', prompt: 'test', input_media: [], parameters: {},
    batch_size: 1, outputs: [{ id: 'out', media_path: '/image.png', media_type: 'image', saved_to_library: false }],
    status, created_at: '2026-09-15T08:00:00Z',
  };
  const onDelete = vi.fn();
  const onOpenDetail = vi.fn();
  render(<ResultCard generation={generation} onDelete={onDelete} onOpenDetail={onOpenDetail} />);
  const more = screen.getByRole('button', { name: 'card.more' });
  expect(more.closest('[data-card-time-actions]')?.querySelector('time')).toHaveAttribute('datetime', generation.created_at);
  fireEvent.click(more);
  fireEvent.click(screen.getByRole('menuitem', { name: 'card.delete' }));
  expect(onDelete).toHaveBeenCalledWith(generation);
  expect(onOpenDetail).not.toHaveBeenCalled();
});
