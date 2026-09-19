import { afterEach, beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import { runImportPreview } from "../lib/seriesImportAnalysis";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
        isAxiosError: (error: any) => error?.isAxiosError === true,
    },
}));

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

it("uploads once and polls the durable import preview job", async () => {
    const result = { import_id: "import", episodes: [{ title: "Episode 1" }] };
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "job", status: "running" } });
    vi.mocked(axios.get).mockResolvedValue({
        data: { id: "job", status: "completed", result },
    });
    const pending = runImportPreview(
        "/api", new File(["script"], "script.md", { type: "text/markdown" }), 3,
    );
    await vi.runAllTimersAsync();

    expect(await pending).toEqual(result);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(
        "/api/series/import/preview-jobs/job",
        { timeout: 15000 },
    );
});

it("recovers transient polling failures without uploading the file again", async () => {
    const result = { import_id: "import", episodes: [] };
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "job", status: "running" } });
    vi.mocked(axios.get)
        .mockRejectedValueOnce({ isAxiosError: true })
        .mockResolvedValueOnce({ data: { id: "job", status: "completed", result } });
    const pending = runImportPreview("/api", new File(["script"], "script.md"), 3);
    await vi.runAllTimersAsync();

    expect(await pending).toEqual(result);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledTimes(2);
});
