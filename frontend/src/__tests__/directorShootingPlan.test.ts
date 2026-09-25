import { afterEach, beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import { generateDirectorShootingPlan } from "../lib/directorShootingPlan";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
        put: vi.fn(),
        isAxiosError: (error: any) => error?.isAxiosError === true,
    },
}));

const plan = { schema_version: 1, scenes: [] } as any;

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

it("polls queued plan jobs until the durable plan result arrives and reports progress", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: {
        id: "plan-job", status: "queued", result: null, progress: { completed: 0, total: 2 },
    } } as any);
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: {
            id: "plan-job", status: "running", result: null, progress: { completed: 1, total: 2 },
        } } as any)
        .mockResolvedValueOnce({ data: {
            id: "plan-job", status: "completed", result: { plan }, progress: { completed: 2, total: 2 },
        } } as any);
    const listener = vi.fn();

    const pending = generateDirectorShootingPlan("/api", "film", listener);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(plan);
    expect(axios.post).toHaveBeenCalledWith(
        "/api/projects/film/director-shooting-plan-jobs", {}, { timeout: 15000 },
    );
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        status: "running", progress: { completed: 1, total: 2 },
    }));
});

it("surfaces a failed plan job without treating it as an empty plan", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: {
        id: "plan-job", status: "failed", result: null, error: "Completed chunks are saved; retry to resume.",
    } } as any);

    await expect(generateDirectorShootingPlan("/api", "film")).rejects.toThrow(
        "Completed chunks are saved; retry to resume.",
    );
    expect(axios.get).not.toHaveBeenCalled();
});
