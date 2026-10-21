import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentRequest } from '@/lib/api';
import AgentHistory from './AgentHistory';
vi.mock('@/lib/api', () => ({ agentRequest: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
it('opens saved messages, filters history and closes', async () => {
  vi.mocked(agentRequest).mockImplementation(async path => (path === '/sessions'
    ? { sessions: [{ id: 'old', title: '早期方案', updated_at: 1000 }] }
    : { messages: [{ id: 'm1', role: 'user', content: '最早约定使用水墨风格' }, { id: 'm2', role: 'assistant', content: '方案已讨论' }] }) as never);
  render(<AgentHistory />);
  expect(agentRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '对话历史' }));
  expect(await screen.findByText('最早约定使用水墨风格')).toBeInTheDocument();
  expect(agentRequest).toHaveBeenCalledWith('/sessions/old/messages');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '水墨' } });
  expect(screen.queryByText('方案已讨论')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭对话历史' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('discards stale responses after switching conversations', async () => {
  let resolveOld!: (value: unknown) => void;
  vi.mocked(agentRequest).mockImplementation(path => {
    if (path === '/sessions') return Promise.resolve({ sessions: [{ id: 'old', title: '旧会话', updated_at: 1 }, { id: 'new', title: '新会话', updated_at: 2 }] }) as never;
    if (path === '/sessions/old/messages') return new Promise(resolve => { resolveOld = resolve; }) as never;
    return Promise.resolve({ messages: [{ id: 'new-message', role: 'user', content: '新会话内容' }] }) as never;
  });
  render(<AgentHistory />);
  fireEvent.click(screen.getByRole('button', { name: '对话历史' }));
  await waitFor(() => expect(agentRequest).toHaveBeenCalledWith('/sessions/old/messages'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'new' } });
  expect(await screen.findByText('新会话内容')).toBeInTheDocument();
  resolveOld({ messages: [{ id: 'old-message', role: 'user', content: '过期响应' }] });
  await waitFor(() => expect(screen.queryByText('过期响应')).not.toBeInTheDocument());
});
it('offers retry after a failed load', async () => {
  vi.mocked(agentRequest).mockRejectedValueOnce(new Error('网络错误')).mockResolvedValue({ sessions: [] });
  render(<AgentHistory />);
  fireEvent.click(screen.getByRole('button', { name: '对话历史' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('网络错误');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('暂无历史消息')).toBeInTheDocument();
});
