import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FramingDiagnosticsPanel } from "./FramingDiagnosticsPanel";
import { useWorkbenchStore } from "../state/workbench-store";
import { designRevision, type DesignPreview } from "../design/design-proposal";

const initial = useWorkbenchStore.getState();
afterEach(() => useWorkbenchStore.setState(initial, true));
it("checks without authoring, keeps results while scrubbing and expires after camera or rule edits", () => {
  const before = useWorkbenchStore.getState();
  render(<FramingDiagnosticsPanel preview={null} />);
  fireEvent.click(screen.getByRole("button", {name:"检查当前设计构图"}));
  expect(screen.getByText(/已检查全部/)).toBeInTheDocument();
  expect(useWorkbenchStore.getState()).toBe(before);
  act(() => useWorkbenchStore.getState().setPlayheadFrame(25));
  expect(screen.queryByText(/请重新检查/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox",{name:"留框范围"}),{target:{value:"center"}});
  expect(screen.getByText(/请重新检查/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name:"检查当前设计构图"}));
  act(() => useWorkbenchStore.getState().setCameraZoom(before.selectedCameraId,2));
  expect(screen.queryByText(/已检查全部/)).not.toBeInTheDocument();
  expect(screen.getByText(/请重新检查/)).toBeInTheDocument();
});
it("analyzes the unapplied preview and invalidates it on leaving preview", () => {
  const state = useWorkbenchStore.getState();
  const preview: DesignPreview = {baseRevision:designRevision(state), cameraId:state.selectedCameraId,
    characters:state.characters, actorMappings:state.actorMappings, crowdGroups:state.crowdGroups, sceneObjects:state.sceneObjects,
    cameras:structuredClone(state.cameras),cameraPaths:{},dialogueTimeline:{...state.dialogueTimeline,durationSeconds:1,tracks:[]}};
  preview.cameras[state.selectedCameraId].subjectTargetIds=["preview-only-missing"];
  const {rerender}=render(<FramingDiagnosticsPanel preview={preview} />);
  fireEvent.click(screen.getByRole("button",{name:"检查预览构图"}));
  expect(screen.getByText(/目标缺失，未检查/)).toBeInTheDocument();
  expect(screen.getByText(/preview-only-missing/)).toBeInTheDocument();
  expect(useWorkbenchStore.getState().cameras).toBe(state.cameras);
  rerender(<FramingDiagnosticsPanel preview={null} />);
  expect(screen.queryByText(/preview-only-missing/)).not.toBeInTheDocument();
  expect(screen.getByText(/请重新检查/)).toBeInTheDocument();
});
