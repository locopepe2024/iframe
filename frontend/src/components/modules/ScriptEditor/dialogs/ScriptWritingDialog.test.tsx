import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ScriptWritingDialog from './ScriptWritingDialog';
import { scriptEditorApi } from '@/lib/scriptEditorApi';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/scriptEditorApi', () => ({
  scriptEditorApi: {
    startScriptWriting: vi.fn(),
    getScriptWritingJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it('generates an outline expansion, allows editing the draft, and applies it', async () => {
  vi.mocked(scriptEditorApi.startScriptWriting).mockResolvedValue({
    id: 'job-1',
    status: 'completed',
    result: { draft: 'INT. 赌桌 - 夜\n纲手抬起拳头。', mode: 'expand_outline', title: '筹码不能流血' },
  });
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <ScriptWritingDialog
      open
      onClose={onClose}
      onApply={onApply}
      mode="expand_outline"
      projectId="episode-1"
      title="筹码不能流血"
      sourceText="纲手挥拳前手指发抖。"
    />,
  );

  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3500' } });
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  await screen.findByLabelText('preview');
  expect(scriptEditorApi.startScriptWriting).toHaveBeenCalledWith(expect.objectContaining({
    project_id: 'episode-1',
    mode: 'expand_outline',
    title: '筹码不能流血',
    source_text: '纲手挥拳前手指发抖。',
    target_word_count: 3500,
  }));
  expect(vi.mocked(scriptEditorApi.startScriptWriting).mock.calls[0][0]).not.toHaveProperty('duration_minutes');

  fireEvent.change(screen.getByLabelText('preview'), { target: { value: '修订后的剧本。' } });
  fireEvent.click(screen.getByRole('button', { name: 'replace' }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith('expand_outline', '修订后的剧本。'));
  expect(onClose).toHaveBeenCalledOnce();
});

it('switches to continuation mode and reports a generation failure', async () => {
  vi.mocked(scriptEditorApi.startScriptWriting).mockRejectedValue(new Error('LLM is not configured'));
  render(
    <ScriptWritingDialog
      open
      onClose={vi.fn()}
      onApply={vi.fn()}
      mode="expand_outline"
      scriptDocumentId="document-1"
      title="未命名剧本"
      sourceText="现有剧本正文。"
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'continue' }));
  expect(screen.getByRole('spinbutton')).toHaveAccessibleName('additionalWordCount characters');
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('LLM is not configured');
  expect(scriptEditorApi.startScriptWriting).toHaveBeenCalledWith(expect.objectContaining({
    script_document_id: 'document-1',
    mode: 'continue',
    target_word_count: 2000,
  }));
});

it('prevents submission until a valid integer character target is entered', () => {
  render(<ScriptWritingDialog open onClose={vi.fn()} onApply={vi.fn()} mode="expand_outline" scriptDocumentId="document-1" title="本集" sourceText="大纲。" />);
  const input = screen.getByRole('spinbutton');
  for (const value of ['0', '99', '20001', '1000.5']) {
    fireEvent.change(input, { target: { value } });
    expect(screen.getByRole('button', { name: 'generate' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('invalidWordCount');
  }
  fireEvent.change(input, { target: { value: '3000' } });
  expect(screen.getByRole('button', { name: 'generate' })).toBeEnabled();
  expect(scriptEditorApi.startScriptWriting).not.toHaveBeenCalled();
});
