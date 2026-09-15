import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import PlaygroundSessionSubnav from './PlaygroundSessionSubnav';
import { usePlaygroundStore } from './usePlaygroundStore';
const api = vi.hoisted(() => ({ deleteSession: vi.fn().mockResolvedValue({ ok: true }), updateSession: vi.fn() }));
const controller = vi.hoisted(() => ({ createPlaygroundSession: vi.fn().mockResolvedValue({}), openPlaygroundSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ playgroundApi: api }));
vi.mock('./playgroundSessionController', () => controller);
const session = { id: 's', title: '第一个测试会话', updated_at: '2026-09-15', created_at: '2026-09-15', draft: { mode: 't2i' as const, model_id: '', prompt: '', input_media: [], parameters: {}, batch_size: 1 } };
beforeEach(() => {
  vi.clearAllMocks();
  usePlaygroundStore.setState({ sessions: [session], activeSessionId: 's', history: [] });
});
it('shortens titles and renames through the session menu', async () => {
  api.updateSession.mockResolvedValue({ ...session, title: '新会话名称' });
  render(<PlaygroundSessionSubnav />);
  expect(screen.getByTitle(session.title)).toHaveTextContent('第一个测试...');
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
