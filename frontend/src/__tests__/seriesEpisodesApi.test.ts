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

it("loads the shared outline and episode production context", async () => {
  vi.mocked(axios.get).mockResolvedValue({
    data: {
      available: true,
      root: { document_id: "root-doc", title: "柳如烟剧情", project_id: "outline-project" },
      series: { id: "series-1", title: "柳如烟剧情" },
      episodes: [{ document_id: "ep-doc", title: "第一集", episode_number: 1, project_id: "episode-1" }],
    },
  });

  await expect(api.getProjectAuthoringContext("episode-1")).resolves.toMatchObject({
    available: true,
    root: { project_id: "outline-project" },
    episodes: [{ project_id: "episode-1" }],
  });
  expect(axios.get).toHaveBeenCalledWith(`${API_URL}/projects/episode-1/authoring-context`, {
    headers: { "Cache-Control": "no-cache" },
  });
});

it("shares concurrent series reads but fetches fresh data after completion", async () => {
  let finish: (value: any) => void = () => {};
  vi.mocked(axios.get).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const first = api.getSeries("series-one");
  const second = api.getSeries("series-one");
  expect(axios.get).toHaveBeenCalledTimes(1);
  finish({ data: { id: "series-one", title: "Original" } });
  expect(await first).toEqual(await second);
  vi.mocked(axios.get).mockResolvedValueOnce({ data: { id: "series-one", title: "Updated" } });
  expect(await api.getSeries("series-one")).toMatchObject({ title: "Updated" });
  expect(axios.get).toHaveBeenCalledTimes(2);
});

it("does not share different series or retain a failed request", async () => {
  vi.mocked(axios.get).mockRejectedValueOnce(new Error("unavailable"));
  vi.mocked(axios.get).mockResolvedValueOnce({ data: { id: "series-two" } });
  const failed = api.getSeries("series-one");
  const other = api.getSeries("series-two");
  await expect(failed).rejects.toThrow("unavailable");
  await expect(other).resolves.toMatchObject({ id: "series-two" });
  vi.mocked(axios.get).mockResolvedValueOnce({ data: { id: "series-one" } });
  await expect(api.getSeries("series-one")).resolves.toMatchObject({ id: "series-one" });
  expect(axios.get).toHaveBeenCalledTimes(3);
});
