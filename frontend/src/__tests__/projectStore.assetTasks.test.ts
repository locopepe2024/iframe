// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { useProjectStore } from "@/store/projectStore";

beforeEach(() => {
  localStorage.clear();
  useProjectStore.setState({ generatingTasks: [] });
});

it("persists task identity and ownership fields needed to resume polling", () => {
  const store = useProjectStore.getState();
  store.addGeneratingTask("asset-1", "reference_sheet", 2, "project-1", "character");
  expect(JSON.parse(localStorage.getItem("project-storage")!).state.generatingTasks).toEqual([]);
  useProjectStore.getState().setGeneratingTaskId(
    "asset-1",
    "reference_sheet",
    "project-1",
    "character",
    "task-1",
  );

  expect(useProjectStore.getState().generatingTasks).toEqual([{
    assetId: "asset-1",
    generationType: "reference_sheet",
    batchSize: 2,
    projectId: "project-1",
    assetType: "character",
    taskId: "task-1",
    startedAt: expect.any(Number),
  }]);
  expect(JSON.parse(localStorage.getItem("project-storage")!).state.generatingTasks[0].taskId)
    .toBe("task-1");
});

it("drops project-scoped version 1 task markers that have no server task ID", async () => {
  localStorage.setItem("project-storage", JSON.stringify({
    state: {
      projects: [],
      generatingTasks: [{
        assetId: "stuck-asset",
        generationType: "reference_sheet",
        batchSize: 2,
        projectId: "project-1",
        assetType: "character",
      }],
    },
    version: 1,
  }));

  await useProjectStore.persist.rehydrate();

  expect(useProjectStore.getState().generatingTasks).toEqual([]);
});

it("drops v2 task IDs that lack the identity fields required for recovery", async () => {
  localStorage.setItem("project-storage", JSON.stringify({
    state: {
      projects: [],
      generatingTasks: [
        { assetId: "missing-project", generationType: "reference_sheet", taskId: "task-1", assetType: "character" },
        { assetId: "missing-type", generationType: "reference_sheet", taskId: "task-2", projectId: "project-1" },
        { assetId: " ", generationType: "reference_sheet", taskId: "task-3", projectId: "project-1", assetType: "character" },
        { generationType: "reference_sheet", taskId: "task-4", projectId: "project-1", assetType: "character" },
        { assetId: "valid-asset", generationType: "all", taskId: "task-5", projectId: "project-2", assetType: "scene" },
      ],
    },
    version: 2,
  }));

  await useProjectStore.persist.rehydrate();

  expect(useProjectStore.getState().generatingTasks).toEqual([{
    assetId: "valid-asset",
    generationType: "all",
    taskId: "task-5",
    projectId: "project-2",
    assetType: "scene",
    batchSize: 1,
    startedAt: expect.any(Number),
  }]);
});

it("removes a completed task only from its matching project", () => {
  const store = useProjectStore.getState();
  store.addGeneratingTask("same-id", "all", 1, "project-1", "scene");
  store.addGeneratingTask("same-id", "all", 1, "project-2", "scene");
  useProjectStore.getState().removeGeneratingTask("same-id", "all", "project-1");

  expect(useProjectStore.getState().generatingTasks.map((task) => task.projectId)).toEqual(["project-2"]);
});
