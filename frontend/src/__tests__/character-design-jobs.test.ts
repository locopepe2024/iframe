import { afterEach, expect, it, vi } from 'vitest';
import { requestCharacterDesignJob } from '@/lib/characterDesignJobs';
import { agentRequest } from '@/lib/api';

vi.mock('@/lib/api', () => ({ agentRequest: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('bounds a stalled status read even when the transport never settles', async () => {
    vi.useFakeTimers();
    vi.mocked(agentRequest).mockImplementation(() => new Promise(() => {}));
    const pending = requestCharacterDesignJob('/character-design/draft/jobs/existing', 'GET', undefined, 100);
    const assertion = expect(pending).rejects.toThrow('读取上次优化结果');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    const options = vi.mocked(agentRequest).mock.calls[0][3]!;
    expect(options.signal?.aborted).toBe(true);
    expect(options.cache).toBe('no-store');
    expect(agentRequest).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

it('returns a completed result and clears its deadline without starting generation', async () => {
    vi.useFakeTimers();
    const result = { id: 'existing', status: 'completed', result: { identity: {}, look: {} } };
    vi.mocked(agentRequest).mockResolvedValue(result);
    await expect(requestCharacterDesignJob('/character-design/draft/latest-job?character_name=role')).resolves.toEqual(result);
    expect(vi.getTimerCount()).toBe(0);
    expect(agentRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(agentRequest).mock.calls[0][1]).toBe('GET');
});
