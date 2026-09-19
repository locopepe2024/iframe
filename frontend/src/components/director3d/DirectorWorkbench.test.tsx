import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { App } from "./App";
import { POSE_PRESETS } from "./pose/pose-presets";
import { useWorkbenchStore } from "./state/workbench-store";

vi.mock("./scene/HumanoidStage", () => ({
  HumanoidStage: () => <div id="director-viewport" role="tabpanel" aria-label="mock 3D stage" />,
}));

const initialState = useWorkbenchStore.getState();

beforeEach(() => {
  useWorkbenchStore.setState(initialState, true);
  vi.stubGlobal("fetch", vi.fn());
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
