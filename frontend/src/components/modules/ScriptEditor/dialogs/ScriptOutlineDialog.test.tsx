import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ScriptOutlineDialog from './ScriptOutlineDialog';
import { scriptEditorApi, type WritingPlanDraft, type WritingWorkspace } from '@/lib/scriptEditorApi';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => key === 'episode' ? `episode ${values?.number}` : key }));
vi.mock('@/lib/scriptEditorApi', () => ({ scriptEditorApi: { startOutlineAnalysis: vi.fn(), getOutlineAnalysisJob: vi.fn(), confirmWritingPlan: vi.fn() } }));
const draft: WritingPlanDraft = { background: '梦境', style: '', point_of_view: '第一视角', characters: '角色', constraints: '不露脸', missing_information: ['缺少身份'], suggestions: ['增加环境声'], episodes: Array.from({ length: 24 }, (_, i) => ({ number: i + 1, title: `标题${i + 1}`, outline: `事件${i + 1}`, opening_state: '', ending_state: '', characters: '', target_word_count: 2000 })) };
const workspace: WritingWorkspace = { root_document_id: 'root', root_title: '总纲', selected_episode_number: null, source_text: '共24集', source_hash: 'hash', source_changed: false, plan: null };
const confirmed: WritingWorkspace = { ...workspace, plan: { ...draft, revision: 'rev1', source_hash: 'hash', episodes: draft.episodes.map(e => ({ ...e, document_id: `child-${e.number}`, word_count: 0 })) } };

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.mocked(scriptEditorApi.startOutlineAnalysis).mockResolvedValue({ id: 'analysis', status: 'completed', result: { draft: structuredClone(draft), source_hash: 'hash' } });
  vi.mocked(scriptEditorApi.confirmWritingPlan).mockResolvedValue(confirmed);
});

it('requires review and confirmation, then an explicit episode selection without generating episode one', async () => {
  const onNavigate = vi.fn().mockResolvedValue(undefined);
  const onWorkspace = vi.fn();
  const view = render(<ScriptOutlineDialog open workspace={workspace} onClose={vi.fn()} onWorkspace={onWorkspace} onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'analyze' }));
  await screen.findByLabelText('background');
  expect(screen.getByText('缺少身份')).toBeInTheDocument();
  expect(screen.getByText('增加环境声')).toBeInTheDocument();
  expect(screen.getAllByRole('option')).toHaveLength(24);
  fireEvent.change(screen.getByLabelText('background'), { target: { value: '修订世界观' } });
  fireEvent.change(screen.getByLabelText('selectEpisode'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('episodeTitle'), { target: { value: '修订第二集' } });
  fireEvent.change(screen.getByLabelText('target'), { target: { value: '3500' } });
  fireEvent.click(screen.getByRole('button', { name: 'confirm' }));
  await waitFor(() => expect(onWorkspace).toHaveBeenCalledWith(confirmed));
  const payload = vi.mocked(scriptEditorApi.confirmWritingPlan).mock.calls[0][1];
  expect(payload.draft.background).toBe('修订世界观');
  expect(payload.draft.episodes[1]).toMatchObject({ title: '修订第二集', target_word_count: 3500 });
  expect(onNavigate).not.toHaveBeenCalled();
  view.rerender(<ScriptOutlineDialog open workspace={confirmed} onClose={vi.fn()} onWorkspace={onWorkspace} onNavigate={onNavigate} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'openEpisode' })[23]);
  expect(onNavigate).toHaveBeenCalledWith('child-24');
});

it('preserves edits on a stale revision error and blocks invalid targets', async () => {
  vi.mocked(scriptEditorApi.confirmWritingPlan).mockRejectedValue({ response: { data: { detail: '规划已更新' } } });
  render(<ScriptOutlineDialog open workspace={workspace} onClose={vi.fn()} onWorkspace={vi.fn()} onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'analyze' }));
  await screen.findByLabelText('episodeTitle');
  fireEvent.change(screen.getByLabelText('episodeTitle'), { target: { value: '保留我的修改' } });
  fireEvent.change(screen.getByLabelText('target'), { target: { value: '99' } });
  expect(screen.getByRole('button', { name: 'confirm' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('target'), { target: { value: '3000' } });
  fireEvent.click(screen.getByRole('button', { name: 'confirm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('规划已更新');
  expect(screen.getByLabelText('episodeTitle')).toHaveValue('保留我的修改');
});

it('keeps polling a running multi-stage outline beyond the old fifteen-minute deadline', async () => {
  const { act } = await import('@testing-library/react');
  vi.useFakeTimers();
  try {
    vi.mocked(scriptEditorApi.startOutlineAnalysis).mockResolvedValue({ id: 'long-analysis', status: 'running' });
    let polls = 0;
    vi.mocked(scriptEditorApi.getOutlineAnalysisJob).mockImplementation(async () => ++polls > 601
      ? { id: 'long-analysis', status: 'completed', result: { draft: structuredClone(draft), source_hash: 'hash' } }
      : { id: 'long-analysis', status: 'running' });
    render(<ScriptOutlineDialog open workspace={workspace} onClose={vi.fn()} onWorkspace={vi.fn()} onNavigate={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'analyze' }));
      await vi.advanceTimersByTimeAsync(905000);
    });
    expect(polls).toBe(602);
    expect(screen.getByLabelText('background')).toHaveValue('梦境');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});
