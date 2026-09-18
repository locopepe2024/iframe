import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAgentConversation } from './useAgentConversation';
import { agentRequest } from '@/lib/api';
import { usePlaygroundStore } from './usePlaygroundStore';

vi.mock('@/lib/api', () => ({ agentRequest: vi.fn() }));
afterEach(() => {
    vi.resetAllMocks();
    usePlaygroundStore.setState({ prompt: '', inputMedia: [] });
});

const models = [{ id: 'sol', api_model_id: 'gpt-5.6-sol', display_name: 'GPT 5.6 Sol' }];

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

function mockConversation(messageRequest: Promise<unknown>) {
    vi.mocked(agentRequest).mockImplementation((path, method) => {
        if (path === '/models') return Promise.resolve({ models });
        if (path.startsWith('/playground/')) return Promise.resolve({ session: { model: 'gpt-5.6-sol' }, messages: [], busy_until: 0 });
        if (path === '/sessions' && method === 'POST') return Promise.resolve({ session: { id: 'chat-session' } });
        if (path === '/sessions/chat-session/messages' && method === 'POST') return messageRequest as Promise<never>;
        throw new Error(`Unexpected request: ${method || 'GET'} ${path}`);
    });
}

it('preloads Chat SKUs in video mode and shows the saved model on first Agent switch', async () => {
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

it('clears the submitted prompt immediately and keeps it clear after success', async () => {
    const response = deferred<unknown>();
    mockConversation(response.promise);
    usePlaygroundStore.setState({ prompt: '分析这个镜头', inputMedia: ['/reference.png'] });
    const hook = renderHook(() => useAgentConversation(true, 'session'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    let sending!: Promise<void>;
    act(() => { sending = hook.result.current.send(); });
    expect(usePlaygroundStore.getState().prompt).toBe('');
    expect(usePlaygroundStore.getState().inputMedia).toEqual(['/reference.png']);

    await act(async () => {
        response.resolve({
            user_message: { id: 'user-message', role: 'user', content: '分析这个镜头' },
            assistant_message: { id: 'assistant-message', role: 'assistant', content: '完成' },
        });
        await sending;
    });
    expect(usePlaygroundStore.getState().prompt).toBe('');
    expect(hook.result.current.messages).toHaveLength(2);
    hook.unmount();
});

it('restores the submitted prompt when sending fails and the input is still empty', async () => {
    const response = deferred<unknown>();
    mockConversation(response.promise);
    usePlaygroundStore.setState({ prompt: '需要重试的内容' });
    const hook = renderHook(() => useAgentConversation(true, 'session'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    let sending!: Promise<void>;
    act(() => { sending = hook.result.current.send(); });
    expect(usePlaygroundStore.getState().prompt).toBe('');
    await act(async () => { response.reject(new Error('上游失败')); await sending; });

    expect(usePlaygroundStore.getState().prompt).toBe('需要重试的内容');
    expect(hook.result.current.error).toBe('上游失败');
    hook.unmount();
});

it('does not overwrite a new prompt typed while a failed request is pending', async () => {
    const response = deferred<unknown>();
    mockConversation(response.promise);
    usePlaygroundStore.setState({ prompt: '第一次输入' });
    const hook = renderHook(() => useAgentConversation(true, 'session'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    let sending!: Promise<void>;
    act(() => { sending = hook.result.current.send(); });
    act(() => usePlaygroundStore.getState().setPrompt('等待时的新输入'));
    await act(async () => { response.reject(new Error('上游失败')); await sending; });

    expect(usePlaygroundStore.getState().prompt).toBe('等待时的新输入');
    hook.unmount();
});

it('does not restore a failed prompt after the user switches sessions', async () => {
    const response = deferred<unknown>();
    mockConversation(response.promise);
    usePlaygroundStore.setState({ prompt: '第一个会话的输入' });
    const hook = renderHook(({ sessionId }) => useAgentConversation(true, sessionId), { initialProps: { sessionId: 'session' } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    let sending!: Promise<void>;
    act(() => { sending = hook.result.current.send(); });
    hook.rerender({ sessionId: 'next-session' });
    await act(async () => { response.reject(new Error('上游失败')); await sending; });

    expect(usePlaygroundStore.getState().prompt).toBe('');
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
