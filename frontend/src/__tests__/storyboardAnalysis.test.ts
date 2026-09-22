import { afterEach, beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import { analyzeStoryboardPreview, refineStoryboardPreview } from "../lib/storyboardAnalysis";

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
