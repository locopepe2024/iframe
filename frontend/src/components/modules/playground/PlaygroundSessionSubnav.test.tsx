import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import PlaygroundSessionSubnav from './PlaygroundSessionSubnav';
import { usePlaygroundStore } from './usePlaygroundStore';
const api = vi.hoisted(() => ({ deleteSession: vi.fn().mockResolvedValue({ ok: true }), updateSession: vi.fn() }));
const agent = vi.hoisted(() => ({ agentRequest: vi.fn().mockResolvedValue({ categories: [] }) }));
const controller = vi.hoisted(() => ({ createPlaygroundSession: vi.fn().mockResolvedValue({}), openPlaygroundSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ playgroundApi: api, agentRequest: agent.agentRequest }));
vi.mock('./playgroundSessionController', () => controller);
const session = { id: 's', title: '第一个测试会话', updated_at: '2026-09-15', created_at: '2026-09-15', draft: { mode: 't2i' as const, model_id: '', prompt: '', input_media: [], parameters: {}, batch_size: 1 } };
beforeEach(() => {
  vi.clearAllMocks();
  usePlaygroundStore.setState({ sessions: [session], activeSessionId: 's', history: [] });
});
it('shortens titles and renames through the session menu', async () => {
  api.updateSession.mockResolvedValue({ ...session, title: '新会话名称' });
  render(<PlaygroundSessionSubnav />);
  const label = screen.getByText('第一个测试...');
  fireEvent.mouseOver(label);
  expect(screen.getByRole('tooltip')).toHaveTextContent(session.title);
  expect(label).not.toHaveAttribute('title');
  fireEvent.mouseLeave(label.closest('[aria-label="navigationLabel"]')!);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(screen.queryByText('allHistory')).not.toBeInTheDocument();
  expect(screen.queryByText('templates')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'manage' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'rename' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'rename' }), { target: { value: '新会话名称' } });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() => expect(usePlaygroundStore.getState().sessions[0].title).toBe('新会话名称'));
});
it('removes the active last session and opens a blank session', async () => {
  render(<PlaygroundSessionSubnav />);
  fireEvent.click(screen.getByRole('button', { name: 'manage' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }));
  await waitFor(() => expect(controller.createPlaygroundSession).toHaveBeenCalledTimes(1));
  expect(api.deleteSession).toHaveBeenCalledWith('s');
  expect(usePlaygroundStore.getState().sessions).toEqual([]);
});

it('opens automatic fact save settings from the session menu', async () => {
  agent.agentRequest.mockResolvedValueOnce({ categories: [{ id: 'health', display_name: '健康', auto_capture_enabled: true }] });
  render(<PlaygroundSessionSubnav />);
  fireEvent.click(screen.getByRole('button', { name: 'manage' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'factSettings' }));
  expect(await screen.findByRole('dialog', { name: 'factSettings' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(agent.agentRequest).toHaveBeenLastCalledWith('/fact-categories/health', 'PATCH', { auto_capture_enabled: false }));
});

it('enables owner-wide memory from the session menu and manages confirmed memories there', async () => {
  agent.agentRequest.mockImplementation((path: string, method?: string) => {
    if (path === '/memory-settings' && method === 'PATCH') return Promise.resolve({ enabled: true });
    if (path === '/memory-settings') return Promise.resolve({ enabled: false });
    if (path === '/memories/extract') return Promise.resolve({ candidates: [{ content: '喜欢象棋', category: 'preference', source_session_id: 's', source_message_id: 'm', source_quote: '我喜欢象棋' }] });
    if (path === '/memories') return Promise.resolve({ memories: [] });
    return Promise.resolve({});
  });
  render(<PlaygroundSessionSubnav />);
  fireEvent.click(screen.getByRole('button', { name: 'manage' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'memorySettings' }));
  expect(await screen.findByRole('dialog', { name: 'memorySettings' })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'memoryEnable' }));
  await waitFor(() => expect(agent.agentRequest).toHaveBeenCalledWith('/memory-settings', 'PATCH', { enabled: true }));
  fireEvent.click(screen.getByRole('button', { name: 'extractMemoryCandidates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'confirmMemory' }));
  await waitFor(() => expect(agent.agentRequest).toHaveBeenCalledWith('/memories', 'POST', expect.objectContaining({ source_quote: '我喜欢象棋' })));
});
