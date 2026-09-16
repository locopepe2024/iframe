import { afterEach, expect, it, vi } from 'vitest';
import { agentRequest } from '@/lib/api';

afterEach(() => vi.unstubAllGlobals());

it('reports an HTML gateway failure without exposing HTML or blaming credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>nginx</html>', {
        status: 502, headers: { 'content-type': 'text/html' },
    })));
    await expect(agentRequest('/sessions/test/messages', 'POST', { content: '15秒允许切镜' }))
        .rejects.toThrow('Chat 连接中断（HTTP 502）');
});

it('preserves a specific JSON backend error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '当前会话正在回复' }), {
        status: 409, headers: { 'content-type': 'application/json' },
    })));
    await expect(agentRequest('/sessions/test/messages', 'POST', { content: '15秒允许切镜' }))
        .rejects.toThrow('当前会话正在回复');
});
