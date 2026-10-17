import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AgentSettings from './AgentSettings';

const agentRequest = vi.hoisted(() => vi.fn());
vi.mock('next-intl', () => ({ useLocale: () => 'zh', useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ agentRequest }));

beforeEach(() => {
  agentRequest.mockReset();
  agentRequest.mockImplementation((path: string, method?: string) => {
    if (path === '/memory-settings' && method === 'PATCH') return Promise.resolve({ enabled: true });
    if (path === '/memory-settings') return Promise.resolve({ enabled: false });
    if (path === '/fact-categories') return Promise.resolve({ categories: [{ id: 'health', display_name: '健康', auto_capture_enabled: true, auto_recall_enabled: false }] });
    if (path === '/fact-categories/health' && method === 'PATCH') return Promise.resolve({ category: { id: 'health', display_name: '健康', auto_capture_enabled: true, auto_recall_enabled: true } });
    return Promise.resolve({ memories: [] });
  });
});

it('keeps memory, capture, and recall as independent owner settings', async () => {
  render(<AgentSettings />);
  fireEvent.click(await screen.findByRole('checkbox', { name: '跨会话自动召回' }));
  await waitFor(() => expect(agentRequest).toHaveBeenCalledWith('/memory-settings', 'PATCH', { enabled: true }));
  fireEvent.click(screen.getByRole('checkbox', { name: '健康 自动召回' }));
  await waitFor(() => expect(agentRequest).toHaveBeenCalledWith('/fact-categories/health', 'PATCH', { auto_recall_enabled: true }));
  expect(screen.getByRole('checkbox', { name: '健康 自动保存' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '健康 自动召回' })).toBeChecked();
});

it('keeps the previous category state when saving fails', async () => {
  agentRequest.mockImplementation((path: string, method?: string) => {
    if (path === '/memory-settings') return Promise.resolve({ enabled: false });
    if (path === '/fact-categories') return Promise.resolve({ categories: [{ id: 'health', display_name: '健康', auto_capture_enabled: true, auto_recall_enabled: false }] });
    if (method === 'PATCH') return Promise.reject(new Error('unavailable'));
    return Promise.resolve({ memories: [] });
  });
  render(<AgentSettings />);
  const capture = await screen.findByRole('checkbox', { name: '健康 自动保存' });
  fireEvent.click(capture);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保存失败'));
  expect(capture).toBeChecked();
});
