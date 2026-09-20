import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "./App";
import DirectorWorkbench from "./DirectorWorkbench";
import { POSE_PRESETS } from "./pose/pose-presets";
import { useWorkbenchStore } from "./state/workbench-store";
import { DIRECTOR_DRAFT_STORAGE_KEY } from "./state/local-draft";

vi.mock("./scene/HumanoidStage", () => ({
  HumanoidStage: () => <div id="director-viewport" role="tabpanel" aria-label="mock 3D stage" />,
}));

const initialState = useWorkbenchStore.getState();

beforeEach(() => {
  useWorkbenchStore.setState(initialState, true);
  vi.stubGlobal("fetch", vi.fn());
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

it("switches director views without calling the standalone API", () => {
  render(<App />);
  const topView = screen.getByRole("tab", { name: "俯视舞台" });
  fireEvent.click(topView);
  expect(topView).toHaveAttribute("aria-selected", "true");
  expect(useWorkbenchStore.getState().viewMode).toBe("top");
  expect(fetch).not.toHaveBeenCalled();
});

it("applies a pose preset and supports undo and redo", () => {
  const store = useWorkbenchStore.getState();
  store.setRigAdmissionIssues([]);
  const preset = POSE_PRESETS.find((item) => item.presetId !== "pose.neutral");
  expect(preset).toBeDefined();
  store.applyPosePreset(store.selectedCharacterId, preset!.presetId);
  expect(useWorkbenchStore.getState().characters[store.selectedCharacterId].activePresetId).toBe(preset!.presetId);
  useWorkbenchStore.getState().undo();
  expect(useWorkbenchStore.getState().characters[store.selectedCharacterId].activePresetId).toBe("pose.neutral");
  useWorkbenchStore.getState().redo();
  expect(useWorkbenchStore.getState().characters[store.selectedCharacterId].activePresetId).toBe(preset!.presetId);
});

it("reports the restored local draft timestamp after reload", async () => {
  const savedAt = "2026-09-20T11:22:33.000Z";
  window.localStorage.setItem(DIRECTOR_DRAFT_STORAGE_KEY, JSON.stringify({
    schemaVersion: "iframe.director3d.browser-draft.v1",
    savedAt,
    state: {},
  }));

  render(<DirectorWorkbench />);

  expect(await screen.findByText(/本地草稿已恢复/)).toBeInTheDocument();
  expect(screen.getByText("已保存到本机")).toBeInTheDocument();
});
