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

  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  await screen.findByLabelText('preview');
  expect(scriptEditorApi.startScriptWriting).toHaveBeenCalledWith(expect.objectContaining({
    project_id: 'episode-1',
    mode: 'expand_outline',
    title: '筹码不能流血',
    source_text: '纲手挥拳前手指发抖。',
  }));

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
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('LLM is not configured');
  expect(scriptEditorApi.startScriptWriting).toHaveBeenCalledWith(expect.objectContaining({
    script_document_id: 'document-1',
    mode: 'continue',
  }));
});
