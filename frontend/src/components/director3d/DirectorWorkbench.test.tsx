import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "./App";
import DirectorWorkbench from "./DirectorWorkbench";
import { POSE_PRESETS } from "./pose/pose-presets";
import { humanoidUrl } from "./data/humanoid";
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

it("moves focus with the view tab keyboard contract", () => {
  render(<App />);
  const directorView = screen.getByRole("tab", { name: "导演视图" });
  const topView = screen.getByRole("tab", { name: "俯视舞台" });

  directorView.focus();
  fireEvent.keyDown(directorView, { key: "ArrowRight" });

  expect(useWorkbenchStore.getState().viewMode).toBe("top");
  expect(topView).toHaveAttribute("aria-selected", "true");
  expect(topView).toHaveFocus();
});

it("announces the local draft save state", async () => {
  render(<App />);
  const characterId = useWorkbenchStore.getState().selectedCharacterId;

  act(() => {
    useWorkbenchStore.getState().renameCharacter(characterId, "交互验收人物");
  });

  const saveStatus = screen.getByText("浏览器场景草稿").closest(".project-identity");
  expect(saveStatus).not.toBeNull();
  expect(saveStatus).toHaveAttribute("aria-busy", "false");
  fireEvent.click(screen.getByRole("button", { name: "保存本地草稿" }));

  expect(await screen.findByText(/本地草稿已保存/)).toBeInTheDocument();
  expect(saveStatus).toHaveAttribute("aria-busy", "false");
  expect(useWorkbenchStore.getState().unsavedChanges).toBe(false);
});

it("keeps the model URL relative for the /static production mount", () => {
  expect(humanoidUrl.startsWith("/")).toBe(false);
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
