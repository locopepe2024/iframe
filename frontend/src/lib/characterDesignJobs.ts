import { agentRequest } from './api';

// These requests only create/read a durable job; the model runs independently.
// Bound both fetch and body decoding so a stalled read cannot retain the spinner.
export async function requestCharacterDesignJob<T>(path: string, method = 'GET', body?: unknown,
    timeoutMs = 30_000): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error('角色设计连接超时；可点击“读取上次优化结果”查询已提交的任务，无需重复生成。'));
            controller.abort();
        }, timeoutMs);
    });
    try {
        return await Promise.race([agentRequest<T>(path, method, body, {
            signal: controller.signal, cache: 'no-store',
        }), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export function waitForCharacterDesignPoll(): Promise<void> {
    return new Promise(resolve => {
        const finish = () => {
            clearTimeout(timer);
            window.removeEventListener('focus', finish);
            document.removeEventListener('visibilitychange', visible);
            resolve();
        };
        const visible = () => { if (document.visibilityState === 'visible') finish(); };
        const timer = setTimeout(finish, 3000);
        window.addEventListener('focus', finish);
        document.addEventListener('visibilitychange', visible);
    });
}
