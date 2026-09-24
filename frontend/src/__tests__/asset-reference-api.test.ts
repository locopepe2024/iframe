import { beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import { API_URL, api } from "../lib/api";

vi.mock("axios", () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        isAxiosError: (error: any) => error?.isAxiosError === true,
    },
}));

beforeEach(() => vi.clearAllMocks());

it("submits one stable asset variant ID through the supported reference field", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { _task_id: "task-1" } });
    const reference = { asset_type: "character" as const, asset_id: "character-1", variant_id: "variant-1" };

    await api.generateAsset(
        "project-1", "character-target", "character", "realistic", undefined,
        "reference_sheet", "prompt", true, "", 2, "uniart/gpt-image-2", undefined,
        reference,
    );

    expect(axios.post).toHaveBeenCalledWith(
        `${API_URL}/projects/project-1/assets/generate`,
        expect.objectContaining({
            reference,
            generation_type: "reference_sheet",
        }),
    );
    const request = vi.mocked(axios.post).mock.calls[0][1] as Record<string, unknown>;
    expect(request).not.toHaveProperty("references");
    expect(request).not.toHaveProperty("image_generation_mode");
    expect(JSON.stringify(request)).not.toContain("private/");
});

it("keeps text mode free of structured references", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { _task_id: "task-2" } });

    await api.generateAsset(
        "project-1", "character-target", "character", "realistic", undefined,
        "reference_sheet", "prompt", true, "", 1, "uniart/gpt-image-2", undefined,
        undefined,
    );

    const request = vi.mocked(axios.post).mock.calls[0][1] as Record<string, unknown>;
    expect(request).not.toHaveProperty("reference");
    expect(request).not.toHaveProperty("references");
    expect(request).not.toHaveProperty("image_generation_mode");
});

it("loads the asset reference index without allowing a cached result", async () => {
    const index = { schema_version: 1, project_id: "project-1", assets: [] };
    vi.mocked(axios.get).mockResolvedValue({ data: index });

    await expect(api.getAssetReferenceIndex("project-1")).resolves.toEqual(index);
    expect(axios.get).toHaveBeenCalledWith(
        `${API_URL}/projects/project-1/asset-index`,
        { headers: { "Cache-Control": "no-cache" } },
    );
});

it("loads the compact asset library index through its dedicated endpoint", async () => {
    const index = { schema_version: 1, project_id: "library", assets: [] };
    vi.mocked(axios.get).mockResolvedValue({ data: index });

    await expect(api.getAssetLibraryIndex()).resolves.toEqual(index);
    expect(axios.get).toHaveBeenCalledWith(
        `${API_URL}/asset-index`,
        { headers: { "Cache-Control": "no-cache" } },
    );
});
