import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ModelSettingsModal from '@/components/common/ModelSettingsModal';
import SeriesModelSettingsModal from '@/components/series/SeriesModelSettingsModal';
import { scriptEditorApi, type ScriptWritingModel } from '@/lib/scriptEditorApi';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/scriptEditorApi', () => ({ scriptEditorApi: { getWritingSettings: vi.fn(), setWritingModel: vi.fn() } }));
vi.mock('@/components/common/GroupedModelGrid', () => ({ default: () => null }));
vi.mock('@/store/projectStore', () => ({
  useProjectStore: (select: (state: unknown) => unknown) => select({ currentProject: { id: 'project' }, updateProject: vi.fn() }),
  IMAGE_MODELS: [], I2V_MODELS: [], ASPECT_RATIOS: [],
}));
vi.mock('@/lib/api', () => ({ api: { getSeriesModelSettings: vi.fn().mockResolvedValue({}) } }));

beforeEach(() => vi.clearAllMocks());

it.each(['deepseek-v4.1-flash', 'kimi-k3'] as const)('project and series settings share the saved %s selection', async selectedModel => {
  let saved: ScriptWritingModel = 'llm-nf-all';
  vi.mocked(scriptEditorApi.getWritingSettings).mockImplementation(async () => ({ model: saved }));
  vi.mocked(scriptEditorApi.setWritingModel).mockImplementation(async model => { saved = model; return { model }; });
  const project = render(<ModelSettingsModal isOpen onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('label')).toHaveValue('llm-nf-all'));
  expect(screen.getByText('scope')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('label'), { target: { value: selectedModel } });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('saved'));
  project.unmount();
  render(<SeriesModelSettingsModal isOpen seriesId="series" onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('label')).toHaveValue(selectedModel));
  fireEvent.change(screen.getByLabelText('label'), { target: { value: 'llm-nf-all' } });
  await waitFor(() => expect(saved).toBe('llm-nf-all'));
  expect(scriptEditorApi.setWritingModel).toHaveBeenLastCalledWith('llm-nf-all');
});
