import { afterEach, expect, it, vi } from "vitest";
import { createFrameEditQueue } from "@/lib/frameEditQueue";

afterEach(() => vi.useRealTimers());

it("saves adopted body, flag and latest lighting in one request", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({});
    const queue = createFrameEditQueue(save, vi.fn(), vi.fn());
    queue.enqueue("project", "frame", { action_description: "adopted", workbench_prompt_is_optimized: true });
    queue.enqueue("project", "frame", { action_description: "visible new light", lighting_override: "new light" });
    await queue.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith("project", "frame", { action_description: "visible new light", workbench_prompt_is_optimized: true, lighting_override: "new light" });
});

it("serializes in-flight edits and separates project identities", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue({});
    const queue = createFrameEditQueue(save, vi.fn(), vi.fn());
    queue.enqueue("p", "f", { action_description: "first" });
    const first = queue.flush();
    await Promise.resolve();
    queue.enqueue("p", "f", { action_description: "second" });
    const second = queue.flush();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await first;
    await second;
    expect(save.mock.calls[1][2]).toEqual({ action_description: "second" });
    queue.enqueue("other", "f", { action_description: "other project" });
    await queue.flush();
    expect(save.mock.calls[2][0]).toBe("other");
});

it("retains failed fields and retries them with the next visible edit", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const onError = vi.fn();
    const queue = createFrameEditQueue(save, vi.fn(), onError);
    queue.enqueue("p", "f", { action_description: "adopted", workbench_prompt_is_optimized: true });
    await expect(queue.flush()).rejects.toThrow("offline");
    expect(queue.hasPending()).toBe(true);
    queue.enqueue("p", "f", { action_description: "latest", lighting_override: "light" });
    await queue.flush();
    expect(save.mock.calls[1][2]).toEqual({ action_description: "latest", workbench_prompt_is_optimized: true, lighting_override: "light" });
    expect(queue.hasPending()).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
});
