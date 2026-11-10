import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ScriptRewriteDialog from './ScriptRewriteDialog';
import { scriptEditorApi } from '@/lib/scriptEditorApi';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/scriptEditorApi', () => ({ scriptEditorApi: { startScriptRewrite: vi.fn(), getScriptWritingJob: vi.fn() } }));
const passage = { selectedText: '她抓住你的衣襟。', beforeText: '你伸出手。', afterText: '梦境碎裂。' };
const props = { passage, title: '第二集', scriptDocumentId: 'document-2', onClose: vi.fn(), onApply: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); });

it('reviews and edits a local proposal before applying it without sending the whole screenplay', async () => {
  vi.mocked(scriptEditorApi.startScriptRewrite).mockResolvedValue({ id: 'rewrite', status: 'completed',
    result: { mode: 'rewrite', title: '第二集', draft: '她松开手。' } });
  const apply = vi.fn().mockResolvedValue(undefined);
  render(<ScriptRewriteDialog {...props} onApply={apply} />);
  expect(screen.getByLabelText('instruction')).toHaveFocus();
  expect(screen.getByRole('button', { name: 'generate' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('instruction'), { target: { value: '让她反应更克制' } });
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  await waitFor(() => expect(screen.getByLabelText('candidate')).toHaveValue('她松开手。'));
  expect(scriptEditorApi.startScriptRewrite).toHaveBeenCalledWith({ script_document_id: 'document-2', title: '第二集',
    selected_text: passage.selectedText, before_text: passage.beforeText, after_text: passage.afterText, instruction: '让她反应更克制' });
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('candidate'), { target: { value: '她慢慢松开手。' } });
  fireEvent.click(screen.getByRole('button', { name: 'replace' }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith('她慢慢松开手。'));
  expect(props.onClose).toHaveBeenCalledOnce();
});

it('keeps a reviewed candidate if regeneration fails and displays an adoption conflict', async () => {
  vi.mocked(scriptEditorApi.startScriptRewrite).mockResolvedValueOnce({ id: 'rewrite', status: 'completed', result: { draft: '保留的新稿', mode: 'rewrite', title: '' } })
    .mockRejectedValueOnce(new Error('upstream error'));
  render(<ScriptRewriteDialog {...props} onApply={vi.fn().mockRejectedValue(new Error('原文已变化'))} />);
  fireEvent.change(screen.getByLabelText('instruction'), { target: { value: '修改' } });
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  await waitFor(() => expect(screen.getByLabelText('candidate')).toHaveValue('保留的新稿'));
  fireEvent.click(screen.getByRole('button', { name: 'regenerate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('upstream error');
  expect(screen.getByLabelText('candidate')).toHaveValue('保留的新稿');
  fireEvent.click(screen.getByRole('button', { name: 'replace' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('原文已变化'));
  expect(props.onClose).not.toHaveBeenCalled();
});

it('discards an outstanding request and ignores its late result', async () => {
  let resolve!: (value: any) => void;
  vi.mocked(scriptEditorApi.startScriptRewrite).mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = render(<ScriptRewriteDialog {...props} />);
  fireEvent.change(screen.getByLabelText('instruction'), { target: { value: '修改' } });
  fireEvent.click(screen.getByRole('button', { name: 'generate' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(props.onClose).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => { resolve({ id: 'late', status: 'completed', result: { draft: '迟到新稿', mode: 'rewrite', title: '' } }); });
  expect(props.onApply).not.toHaveBeenCalled();
});

it('polls the same owned resource and retains modal focus for keyboard users', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(scriptEditorApi.startScriptRewrite).mockResolvedValue({ id: 'queued', status: 'queued' });
    vi.mocked(scriptEditorApi.getScriptWritingJob).mockResolvedValue({ id: 'queued', status: 'completed', result: { draft: '完成', mode: 'rewrite', title: '' } });
    render(<ScriptRewriteDialog {...props} />);
    const close = screen.getByRole('button', { name: 'close' });
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'discard' })).toHaveFocus();
    fireEvent.change(screen.getByLabelText('instruction'), { target: { value: '修改' } });
    fireEvent.click(screen.getByRole('button', { name: 'generate' }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(scriptEditorApi.getScriptWritingJob).toHaveBeenCalledWith('queued', { script_document_id: 'document-2' });
    expect(screen.getByLabelText('candidate')).toHaveValue('完成');
  } finally { vi.useRealTimers(); }
});
