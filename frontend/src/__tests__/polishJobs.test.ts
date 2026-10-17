import axios from "axios";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("axios", () => ({ default: {
    post: vi.fn(), get: vi.fn(),
    interceptors: { request: { use: vi.fn() } },
} }));
import { api } from "@/lib/api";

beforeEach(() => vi.clearAllMocks());

it("returns a completed polish result through the owner scoped job", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "job-1", status: "running" } });
    vi.mocked(axios.get).mockResolvedValue({ data: { status: "completed", result: {
        prompt_cn: "中文", prompt_en: "English",
    } } });
    await expect(api.polishVideoPrompt("shot", "", "project-1")).resolves.toEqual({
        prompt_cn: "中文", prompt_en: "English",
    });
    expect(vi.mocked(axios.post).mock.calls[0][0]).toContain("/projects/project-1/polish-jobs/video");
    expect(vi.mocked(axios.get).mock.calls[0][0]).toContain("/projects/project-1/polish-jobs/job-1");
});

it("preserves the structured model error returned by a completed job", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "job-2", status: "running" } });
    vi.mocked(axios.get).mockResolvedValue({ data: { status: "completed", result: {
        detail: { reason: "json_parse_error", message_zh: "格式错误", message_en: "Invalid format" },
    } } });
    await expect(api.polishR2VPrompt("shot", [], "", "project-1")).rejects.toMatchObject({
        response: { data: { detail: { reason: "json_parse_error" } } },
    });
});
