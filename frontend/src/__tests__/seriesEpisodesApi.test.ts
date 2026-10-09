import { beforeEach, expect, it, vi } from "vitest";
import axios from "axios";
import { API_URL, api } from "../lib/api";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    interceptors: { request: { use: vi.fn() } },
    isAxiosError: (error: any) => error?.isAxiosError === true,
  },
}));

beforeEach(() => vi.clearAllMocks());

it("exposes episode script text to the series overview", async () => {
  vi.mocked(axios.get).mockResolvedValue({
    data: [{ id: "episode-1", original_text: "第一场：寒痕初现" }],
  });

  await expect(api.getSeriesEpisodes("series-1")).resolves.toEqual([
    expect.objectContaining({
      id: "episode-1",
      originalText: "第一场：寒痕初现",
    }),
  ]);
  expect(axios.get).toHaveBeenCalledWith(`${API_URL}/series/series-1/episodes`);
});
