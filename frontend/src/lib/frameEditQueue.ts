export type FrameEdit = Record<string, unknown>;

/** Coalesce edits and serialize requests for each project/frame pair. */
export function createFrameEditQueue(save: (project: string, frame: string, patch: FrameEdit) => Promise<unknown>, onSaved: (project: string, frame: string, patch: FrameEdit, result: any) => void, onError: (error: unknown) => void) {
    const pending = new Map<string, { project: string; frame: string; patch: FrameEdit; timer: ReturnType<typeof setTimeout> }>();
    const failed = new Map<string, { project: string; frame: string; patch: FrameEdit; timer: ReturnType<typeof setTimeout> }>();
    const running = new Map<string, Promise<void>>();
    const send = (key: string): Promise<void> => {
        if (!pending.has(key) && running.has(key)) return running.get(key)!;
        const entry = pending.get(key) || failed.get(key);
        if (!entry) return running.get(key) || Promise.resolve();
        clearTimeout(entry.timer);
        pending.delete(key);
        const task = (running.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
            const patch = { ...failed.get(key)?.patch, ...entry.patch };
            try {
                const result = await save(entry.project, entry.frame, patch);
                failed.delete(key);
                onSaved(entry.project, entry.frame, patch, result);
            } catch (error) {
                failed.set(key, { ...entry, patch });
                onError(error);
                throw error;
            }
        });
        // Consume rejection here as timers/unmount cannot await; flush callers
        // still receive the original failure. A later edit can retry normally.
        const settled = task.finally(() => { if (running.get(key) === settled) running.delete(key); });
        void settled.catch(() => {});
        running.set(key, settled);
        return task;
    };
    return {
        enqueue(project: string, frame: string, patch: FrameEdit) {
            const key = `${project}/${frame}`;
            const old = pending.get(key);
            if (old) clearTimeout(old.timer);
            const timer = setTimeout(() => { void send(key).catch(() => {}); }, 800);
            pending.set(key, { project, frame, patch: { ...old?.patch, ...patch }, timer });
        },
        flush: () => Promise.all(Array.from(new Set([...Array.from(pending.keys()), ...Array.from(running.keys()), ...Array.from(failed.keys())]), send)),
        hasPending: () => pending.size > 0 || running.size > 0 || failed.size > 0,
    };
}
