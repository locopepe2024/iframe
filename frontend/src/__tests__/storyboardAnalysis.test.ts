import { afterEach, beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import { analyzeStoryboardPreview, refineStoryboardPreview } from "../lib/storyboardAnalysis";
import { api } from "../lib/api";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
        isAxiosError: (error: any) => error?.isAxiosError === true,
    },
}));

const frames = [{ action_summary: "Host presents product", duration: 5 }];

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

it("resumes a durable storyboard job and returns its draft", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "job", status: "running" } });
    vi.mocked(axios.get).mockResolvedValue({
        data: { id: "job", status: "completed", result: { frames } },
    });
    const pending = analyzeStoryboardPreview("/api", "project", "script");
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(frames);
    expect(axios.get).toHaveBeenCalledWith(
        "/api/projects/project/storyboard-analysis-jobs/job",
        { timeout: 15000 },
    );
});

it("reports persisted batch progress while polling", async () => {
    const progress = vi.fn();
    vi.mocked(axios.post).mockResolvedValue({
        data: { id: "job", status: "running", progress: { completed: 0, total: 3 } },
    });
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: { id: "job", status: "running", progress: { completed: 2, total: 3 } } })
        .mockResolvedValueOnce({ data: { id: "job", status: "completed", result: { frames }, progress: { completed: 3, total: 3 } } });
    const pending = analyzeStoryboardPreview("/api", "project", "script", progress);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(frames);
    expect(progress.mock.calls).toEqual([[0, 3], [2, 3], [3, 3]]);
});

it("waits through queued and running states before returning the draft", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "job", status: "queued" } });
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: { id: "job", status: "running" } })
        .mockResolvedValueOnce({ data: { id: "job", status: "completed", result: { frames } } });
    const pending = analyzeStoryboardPreview("/api", "project", "script");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual(frames);
    expect(axios.get).toHaveBeenCalledTimes(2);
});

it("stops polling when a task never reaches a terminal state", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "job", status: "running" } });
    vi.mocked(axios.get).mockResolvedValue({ data: { id: "job", status: "running" } });
    const pending = analyzeStoryboardPreview("/api", "project", "script");
    const result = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 2000);
    await result;
});

it("submits the visible draft and accumulated direction for refinement", async () => {
    vi.mocked(axios.post).mockResolvedValue({
        data: { id: "refine", status: "completed", result: { frames } },
    });
    await expect(refineStoryboardPreview(
        "/api", "project", "script", frames, ["Split shot 1"],
    )).resolves.toEqual(frames);
    expect(axios.post).toHaveBeenCalledWith(
        "/api/projects/project/storyboard-analysis-jobs/refine",
        { text: "script", draft: frames, instructions: ["Split shot 1"] },
        { timeout: 15000 },
    );
});

it("uses the durable analysis job before applying frames from the legacy composer", async () => {
    const updatedProject = { id: "project", frames };
    vi.mocked(axios.post)
        .mockResolvedValueOnce({
            data: { id: "job", status: "completed", result: { frames } },
        })
        .mockResolvedValueOnce({ data: updatedProject });

    const pending = api.analyzeToStoryboard("project", "script text");
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(updatedProject);
    const calls = vi.mocked(axios.post).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatch(/\/projects\/project\/storyboard-analysis-jobs$/);
    expect(calls[0][1]).toEqual({ text: "script text" });
    expect(calls[1][0]).toMatch(/\/projects\/project\/storyboard-analysis\/apply$/);
    expect(calls[1][1]).toEqual({ text: "script text", draft: frames });
});

it("retries a transient connection loss while starting storyboard analysis", async () => {
    const updatedProject = { id: "project", frames };
    vi.mocked(axios.post)
        .mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" })
        .mockResolvedValueOnce({
            data: { id: "job", status: "completed", result: { frames } },
        })
        .mockResolvedValueOnce({ data: updatedProject });

    const pending = api.analyzeToStoryboard("project", "script text");
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(updatedProject);
    const calls = vi.mocked(axios.post).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0][0]).toEqual(calls[1][0]);
    expect(calls[0][1]).toEqual(calls[1][1]);
});
