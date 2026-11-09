import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { scriptEditorApi } from '@/lib/scriptEditorApi';
import { useScriptWritingModel } from './useScriptWritingModel';
import ScriptModelSelect from '../components/ScriptModelSelect';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/scriptEditorApi', () => ({ scriptEditorApi: { getWritingSettings: vi.fn(), setWritingModel: vi.fn() } }));

function ModelControl() {
  const settings = useScriptWritingModel();
  return <ScriptModelSelect model={settings.model} modelBusy={settings.saving} modelError={settings.error}
    onModelChange={settings.selectModel} onModelReload={settings.reload} />;
}
beforeEach(() => vi.clearAllMocks());

it('loads the owner preference, saves changes and restores them on remount', async () => {
  vi.mocked(scriptEditorApi.getWritingSettings).mockResolvedValue({ model: 'llm-nf-all' });
  vi.mocked(scriptEditorApi.setWritingModel).mockResolvedValue({ model: 'deepseek-v4.1-flash' });
  const view = render(<ModelControl />);
  expect(screen.getByLabelText('label')).toBeDisabled();
  await waitFor(() => expect(screen.getByLabelText('label')).toHaveValue('llm-nf-all'));
  fireEvent.change(screen.getByLabelText('label'), { target: { value: 'deepseek-v4.1-flash' } });
  await waitFor(() => expect(screen.getByLabelText('label')).toHaveValue('deepseek-v4.1-flash'));
  expect(scriptEditorApi.setWritingModel).toHaveBeenCalledWith('deepseek-v4.1-flash');
  view.unmount();
  vi.mocked(scriptEditorApi.getWritingSettings).mockResolvedValue({ model: 'deepseek-v4.1-flash' });
  render(<ModelControl />);
  await waitFor(() => expect(screen.getByLabelText('label')).toHaveValue('deepseek-v4.1-flash'));
});

it('keeps the saved model after a failed update and allows retrying an initial load failure', async () => {
  vi.mocked(scriptEditorApi.getWritingSettings).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ model: 'llm-nf-all' });
  vi.mocked(scriptEditorApi.setWritingModel).mockRejectedValue(new Error('save failed'));
  render(<ModelControl />);
  fireEvent.click(await screen.findByRole('button', { name: 'retry' }));
  await waitFor(() => expect(screen.getByLabelText('label')).toHaveValue('llm-nf-all'));
  fireEvent.change(screen.getByLabelText('label'), { target: { value: 'deepseek-v4.1-flash' } });
  await screen.findByRole('alert');
  expect(screen.getByLabelText('label')).toHaveValue('llm-nf-all');
  expect(screen.getByLabelText('label')).toBeEnabled();
});
