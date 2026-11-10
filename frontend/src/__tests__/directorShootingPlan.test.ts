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
        "/api/projects/film/director-shooting-plan-jobs", { skills: [] }, { timeout: 60000 },
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

it("waits for a plan that takes several minutes without a total generation deadline", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "plan-job", status: "running", result: null } });
    let polls = 0;
    vi.mocked(axios.get).mockImplementation(async () => ({ data: ++polls < 180
        ? { id: "plan-job", status: "running", result: null }
        : { id: "plan-job", status: "completed", result: { plan } },
    }));
    const pending = generateDirectorShootingPlan("/api", "film");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual(plan);
    expect(axios.get).toHaveBeenCalledTimes(180);
});

it("explains a submit connection timeout without claiming model generation failed", async () => {
    vi.mocked(axios.post).mockRejectedValue({
        isAxiosError: true, code: "ECONNABORTED", message: "timeout of 60000ms exceeded",
    });
    await expect(generateDirectorShootingPlan("/api", "film")).rejects.toThrow("任务提交连接超时");
    expect(axios.get).not.toHaveBeenCalled();
});

it("recovers from a temporary status request timeout while the plan keeps running", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "plan-job", status: "running", result: null } });
    vi.mocked(axios.get)
        .mockRejectedValueOnce({ isAxiosError: true, code: "ECONNABORTED" })
        .mockResolvedValueOnce({ data: { id: "plan-job", status: "completed", result: { plan } } });
    const pending = generateDirectorShootingPlan("/api", "film");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual(plan);
    expect(axios.post).toHaveBeenCalledTimes(1);
});

it("explains repeated status timeouts without claiming the background task stopped", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "plan-job", status: "running", result: null } });
    vi.mocked(axios.get).mockRejectedValue({ isAxiosError: true, code: "ECONNABORTED" });
    const pending = generateDirectorShootingPlan("/api", "film");
    const rejection = expect(pending).rejects.toThrow("状态查询连接超时");
    await vi.runAllTimersAsync();
    await rejection;
    expect(axios.get).toHaveBeenCalledTimes(5);
});
