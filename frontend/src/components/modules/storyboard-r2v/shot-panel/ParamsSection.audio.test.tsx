import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ParamsSection from './ParamsSection';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./usePanelSectionState', () => ({ usePanelSectionState: () => [true, vi.fn()] }));

describe('storyboard generated audio', () => {
  it.each([true, false])('toggles generated audio from %s', (audio) => {
    const onChange = vi.fn();
    render(<ParamsSection shotId="shot" title="Parameters" modelList={[{ id: 'uniart/test', name: 'Test', description: '', duration: { type: 'fixed', value: 5 }, params: { audio: true } }]} params={{ model: 'uniart/test', duration: 5, count: 1, audio }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'generatedAudio' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ audio: !audio }));
  });
  it.each([{}, { audio: false }])('shows audio when capability metadata is %o', (params) => {
    render(<ParamsSection shotId="shot" title="Parameters" modelList={[{ id: 'test', name: 'Test', description: '', duration: { type: 'fixed', value: 5 }, params }]} params={{ model: 'test', duration: 5, count: 1, audio: true }} onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'generatedAudio' })).toBeChecked();
  });
  it('preserves enabled audio when switching to a model whose metadata says false', () => {
    const onChange = vi.fn();
    render(<ParamsSection shotId="shot" title="Parameters" modelList={[
      { id: 'first', name: 'First', description: '', duration: { type: 'fixed', value: 5 }, params: { audio: true } },
      { id: 'h3', name: 'H3', description: '', duration: { type: 'fixed', value: 5 }, params: { audio: false } },
    ]} params={{ model: 'first', duration: 5, count: 1, audio: true }} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: /First/ }).find(button => button.getAttribute('aria-expanded') === 'false')!);
    fireEvent.click(screen.getByRole('button', { name: /H3/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: 'h3', audio: true }));
  });
});
