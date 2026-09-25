import { afterEach, beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import {
    analyzeStoryboardPreview,
    refineStoryboardPreview,
    type StoryboardAnalysisLineage,
} from "../lib/storyboardAnalysis";
import { api } from "../lib/api";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
        isAxiosError: (error: any) => error?.isAxiosError === true,
    },
}));

const frames = [{ action_summary: "Host presents product", duration: 5 }];
const lineage: StoryboardAnalysisLineage = {
    status: "pinned",
    source_revision: 1,
    source_revision_id: "source-r1:hash",
    director_profile_revision: 2,
    director_profile_hash: "director-hash",
    fact_ledger_revision: 1,
    fact_ledger_source_revision_id: "source-r1:hash",
    fact_ledger_status: "current",
    fact_ids: ["fact-1"],
    source_ranges: [{ start: 0, end: 6 }],
};
const analysisDraft = { frames, lineage };

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

it("resumes a durable storyboard job and returns its draft", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "job", status: "running" } });
    vi.mocked(axios.get).mockResolvedValue({
        data: { id: "job", status: "completed", result: analysisDraft },
    });
    const pending = analyzeStoryboardPreview("/api", "project", "script");
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(analysisDraft);
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
        .mockResolvedValueOnce({ data: { id: "job", status: "completed", result: analysisDraft, progress: { completed: 3, total: 3 } } });
    const pending = analyzeStoryboardPreview("/api", "project", "script", progress);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(analysisDraft);
    expect(progress.mock.calls).toEqual([[0, 3], [2, 3], [3, 3]]);
});

it("waits through queued and running states before returning the draft", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "job", status: "queued" } });
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: { id: "job", status: "running" } })
        .mockResolvedValueOnce({ data: { id: "job", status: "completed", result: analysisDraft } });
    const pending = analyzeStoryboardPreview("/api", "project", "script");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual(analysisDraft);
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
        data: { id: "refine", status: "completed", result: analysisDraft },
    });
    await expect(refineStoryboardPreview(
        "/api", "project", "script", frames, ["Split shot 1"], lineage,
    )).resolves.toEqual(analysisDraft);
    expect(axios.post).toHaveBeenCalledWith(
        "/api/projects/project/storyboard-analysis-jobs/refine",
        { text: "script", draft: frames, instructions: ["Split shot 1"], lineage },
        { timeout: 15000 },
    );
});

it("uses the durable analysis job before applying frames from the legacy composer", async () => {
    const updatedProject = { id: "project", frames };
    vi.mocked(axios.post)
        .mockResolvedValueOnce({
            data: { id: "job", status: "completed", result: analysisDraft },
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
    expect(calls[1][1]).toEqual({ text: "script text", draft: frames, lineage });
});

it("retries a transient connection loss while starting storyboard analysis", async () => {
    const updatedProject = { id: "project", frames };
    vi.mocked(axios.post)
        .mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" })
        .mockResolvedValueOnce({
            data: { id: "job", status: "completed", result: analysisDraft },
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
