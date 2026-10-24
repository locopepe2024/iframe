import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ParamsSection from './ParamsSection';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./usePanelSectionState', () => ({ usePanelSectionState: () => [true, vi.fn()] }));

it('keeps the model menu open while scrolling to a lower model', () => {
  const onChange = vi.fn();
  const modelList = Array.from({ length: 12 }, (_, index) => ({
    id: index === 11 ? 'h3' : `model-${index}`,
    name: index === 11 ? 'MiniMax H3' : `Model ${index}`,
    description: '',
    duration: { type: 'fixed' as const, value: 5 },
    params: {},
  }));
  render(<ParamsSection shotId="shot" title="Parameters" modelList={modelList}
    params={{ model: 'model-0', duration: 5, count: 1 }} onChange={onChange} />);

  fireEvent.click(screen.getAllByRole('button', { name: /Model 0/ })
    .find(button => button.getAttribute('aria-expanded') === 'false')!);
  const menu = screen.getByRole('button', { name: 'MiniMax H3' }).parentElement!;
  fireEvent.scroll(menu);
  expect(screen.getByRole('button', { name: 'MiniMax H3' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'MiniMax H3' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: 'h3' }));
});

it('closes the model menu when the surrounding page scrolls', () => {
  render(<ParamsSection shotId="shot" title="Parameters" modelList={[
    { id: 'first', name: 'First', description: '', duration: { type: 'fixed', value: 5 }, params: {} },
    { id: 'h3', name: 'MiniMax H3', description: '', duration: { type: 'fixed', value: 5 }, params: {} },
  ]} params={{ model: 'first', duration: 5, count: 1 }} onChange={vi.fn()} />);

  fireEvent.click(screen.getAllByRole('button', { name: /First/ })
    .find(button => button.getAttribute('aria-expanded') === 'false')!);
  expect(screen.getByRole('button', { name: 'MiniMax H3' })).toBeInTheDocument();
  fireEvent.scroll(window);
  expect(screen.queryByRole('button', { name: 'MiniMax H3' })).not.toBeInTheDocument();
});
