import { beforeEach, expect, it, vi } from "vitest";
import { useProjectStore, type Project, type Series } from "../store/projectStore";

const apiMocks = vi.hoisted(() => ({ deleteSeries: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMocks, API_URL: "", authenticatedFetch: vi.fn() }));

const series = { id: "series", title: "Series", episode_ids: ["listed"] } as Series;
const project = (id: string, seriesId?: string): Project => ({
  id, title: id, originalText: "", characters: [], scenes: [], props: [], frames: [],
  status: "draft", createdAt: "2026-10-05", updatedAt: "2026-10-05", series_id: seriesId,
});
const listed = project("listed", "series");
const unlisted = project("unlisted", "series");
const independent = project("independent");

beforeEach(() => {
  apiMocks.deleteSeries.mockReset();
  useProjectStore.setState({
    seriesList: [series],
    projects: [listed, unlisted, independent],
    currentProject: listed,
    currentSeries: series,
  });
});

it("removes all episode projects after series deletion", async () => {
  apiMocks.deleteSeries.mockResolvedValue({ status: "deleted" });

  await useProjectStore.getState().deleteSeries("series");

  expect(useProjectStore.getState().projects.map(project => project.id)).toEqual(["independent"]);
  expect(useProjectStore.getState().seriesList).toEqual([]);
  expect(useProjectStore.getState().currentProject).toBeNull();
});

it("keeps episode projects when the backend rejects deletion", async () => {
  apiMocks.deleteSeries.mockRejectedValue(new Error("Unavailable"));

  await expect(useProjectStore.getState().deleteSeries("series")).rejects.toThrow("Unavailable");

  expect(useProjectStore.getState().projects).toHaveLength(3);
  expect(useProjectStore.getState().seriesList).toHaveLength(1);
});
