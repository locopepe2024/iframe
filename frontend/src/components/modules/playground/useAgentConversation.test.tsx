import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAgentConversation } from './useAgentConversation';
import { agentRequest } from '@/lib/api';

vi.mock('@/lib/api', () => ({ agentRequest: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it('preloads Chat SKUs in video mode and shows the saved model on first Agent switch', async () => {
    const models = [{ id: 'sol', api_model_id: 'gpt-5.6-sol', display_name: 'GPT 5.6 Sol' }];
    vi.mocked(agentRequest).mockImplementation(async path => path === '/models'
        ? { models } : { session: { model: 'gpt-5.6-sol' }, messages: [], busy_until: 0 });
    const hook = renderHook(({ enabled }) => useAgentConversation(enabled, 'session'), { initialProps: { enabled: false } });
    await waitFor(() => expect(hook.result.current.models).toEqual(models));
    hook.rerender({ enabled: true });
    expect(hook.result.current.model).toBe('gpt-5.6-sol');
    expect(hook.result.current.models).toEqual(models);
    expect(vi.mocked(agentRequest).mock.calls.filter(([path]) => path === '/models')).toHaveLength(1);
    hook.unmount();
});

it('finishes loading automatically after switching to Agent while the catalog is pending', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise(r => { resolve = r; });
    vi.mocked(agentRequest).mockImplementation(path => path === '/models' ? pending as Promise<never>
        : Promise.resolve({ session: { model: 'qwen3.8-flash' }, messages: [], busy_until: 0 }) as Promise<never>);
    const hook = renderHook(({ enabled }) => useAgentConversation(enabled, 'session'), { initialProps: { enabled: false } });
    hook.rerender({ enabled: true });
    expect(hook.result.current.modelsLoading).toBe(true);
    await act(async () => resolve({ models: [{ id: 'qwen', api_model_id: 'qwen3.8-flash', display_name: 'Qwen 3.8 Flash' }] }));
    await waitFor(() => expect(hook.result.current.modelsLoading).toBe(false));
    expect(hook.result.current.model).toBe('qwen3.8-flash');
    expect(hook.result.current.models).toHaveLength(1);
    hook.unmount();
});

it('exposes catalog errors and supports an explicit retry without submitting chat', async () => {
    let fail = true;
    vi.mocked(agentRequest).mockImplementation(async path => {
        if (path === '/models') {
            if (fail) throw new Error('目录连接失败');
            return { models: [{ id: 'sol', api_model_id: 'gpt-5.6-sol', display_name: 'Sol' }] };
        }
        return { session: null, messages: [], busy_until: 0 };
    });
    const hook = renderHook(() => useAgentConversation(true, 'session'));
    await waitFor(() => expect(hook.result.current.modelsError).toBe('目录连接失败'));
    expect(hook.result.current.loading).toBe(true);
    fail = false;
    act(() => hook.result.current.reloadModels());
    await waitFor(() => expect(hook.result.current.model).toBe('gpt-5.6-sol'));
    expect(hook.result.current.modelsError).toBe('');
    expect(vi.mocked(agentRequest).mock.calls.every(([, method]) => method !== 'POST')).toBe(true);
    hook.unmount();
});
