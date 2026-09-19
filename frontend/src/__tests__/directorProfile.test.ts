import { afterEach, beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import { analyzeDirectorProfile, refineDirectorProfile } from "../lib/directorProfile";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
        isAxiosError: (error: any) => error?.isAxiosError === true,
    },
}));

const profile = { setting: { geography: "China" }, prohibitions: ["No invented Japanese signs"] };

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

it("polls a durable director analysis job without a total deadline", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "director-job", status: "running" } });
    vi.mocked(axios.get).mockResolvedValue({
        data: { id: "director-job", status: "completed", result: { profile } },
    });

    const pending = analyzeDirectorProfile("/api", "film");
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(profile);
    expect(axios.get).toHaveBeenCalledWith(
        "/api/projects/film/director-profile-jobs/director-job",
        { timeout: 15000 },
    );
});

it("submits the exact visible profile and accumulated revision history", async () => {
    vi.mocked(axios.post).mockResolvedValue({
        data: { id: "revision", status: "completed", result: { profile } },
    });

    await expect(refineDirectorProfile(
        "/api", "film", profile, ["Keep China", "Emphasize missed calls"],
    )).resolves.toEqual(profile);
    expect(axios.post).toHaveBeenCalledWith(
        "/api/projects/film/director-profile-jobs/refine",
        { draft: profile, instructions: ["Keep China", "Emphasize missed calls"] },
        { timeout: 15000 },
    );
});

it("uses a returned profile even when the worker status is still running", async () => {
    vi.mocked(axios.post).mockResolvedValue({
        data: { id: "director-job", status: "running", result: { profile } },
    });

    await expect(analyzeDirectorProfile("/api", "film")).resolves.toEqual(profile);
    expect(axios.get).not.toHaveBeenCalled();
});

it("continues polling queued worker states until a profile is returned", async () => {
    vi.mocked(axios.post).mockResolvedValue({
        data: { id: "director-job", status: "queued", result: null },
    });
    vi.mocked(axios.get).mockResolvedValue({
        data: { id: "director-job", status: "completed", result: { profile } },
    });

    const pending = analyzeDirectorProfile("/api", "film");
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(profile);
    expect(axios.get).toHaveBeenCalledWith(
        "/api/projects/film/director-profile-jobs/director-job",
        { timeout: 15000 },
    );
});
