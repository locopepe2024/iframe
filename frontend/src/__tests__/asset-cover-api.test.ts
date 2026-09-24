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

it("sets a library cover through the asset-scoped endpoint with a bounded wait", async () => {
  const result = {
    asset_type: "character" as const,
    asset_id: "character-1",
    cover_variant_id: "headshot-variant",
    variant: { id: "headshot-variant", url: "assets/headshot.png", created_at: 2 },
  };
  vi.mocked(axios.post).mockResolvedValue({ data: result });

  await expect(api.setAssetCoverVariant("project-1", "character-1", "character", "headshot-variant"))
    .resolves.toEqual(result);

  expect(axios.post).toHaveBeenCalledWith(
    `${API_URL}/projects/project-1/assets/character/character-1/cover`,
    { variant_id: "headshot-variant" },
    { timeout: 15_000 },
  );
});
