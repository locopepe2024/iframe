import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useEditorStore } from '@/store/editorStore';
import PipelinePanel from './PipelinePanel';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
beforeEach(() => { useEditorStore.setState({ wordCount: 2000, editorMode: 'full' }); });

it('can create with script text and no entities or shots', () => {
  const enter = vi.fn();
  render(<PipelinePanel onEnterPipeline={enter} />);
  const button = screen.getByRole('button', { name: 'panels.productionCreate' });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(enter).toHaveBeenCalledOnce();
});

it('blocks new projects for empty text but permits opening existing ones', () => {
  useEditorStore.setState({ wordCount: 0 });
  const { rerender } = render(<PipelinePanel onEnterPipeline={vi.fn()} />);
  expect(screen.getByRole('button')).toBeDisabled();
  rerender(<PipelinePanel projectId="production-1" onEnterPipeline={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'panels.enterPipeline' })).toBeEnabled();
});

it('uses standalone project actions for a single-episode outline', () => {
  const enter = vi.fn();
  render(<PipelinePanel productionMode="standalone" onEnterPipeline={enter} />);
  expect(screen.getByRole('heading', { name: 'panels.independentProductionTitle' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'panels.createIndependentProject' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'panels.createIndependentProject' }));
  expect(enter).toHaveBeenCalledOnce();
});

it('uses standalone open action for an existing single-episode project', () => {
  render(<PipelinePanel productionMode="standalone" projectId="project-1" onEnterPipeline={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'panels.enterIndependentProject' })).toBeEnabled();
});

it('shows a disabled busy button while opening', () => {
  render(<PipelinePanel onEnterPipeline={vi.fn()} isEntering />);
  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
});

it('hides navigation in embedded mode', () => {
  useEditorStore.setState({ editorMode: 'embedded' });
  render(<PipelinePanel onEnterPipeline={vi.fn()} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('does not offer a production project from the series outline', () => {
  render(<PipelinePanel onEnterPipeline={vi.fn()} productionAvailable={false} />);
  expect(screen.getByText('panels.productionOutlineHint')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
