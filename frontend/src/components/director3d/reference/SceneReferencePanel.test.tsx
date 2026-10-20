import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useWorkbenchStore } from "../state/workbench-store";
import { currentDirectorShotPackage } from "./current-shot-package";
import { SceneReferencePanel } from "./SceneReferencePanel";

const initialState = useWorkbenchStore.getState();
const png = "data:image/png;base64,scene";
beforeEach(() => {
  useWorkbenchStore.setState(initialState, true);
  useWorkbenchStore.getState().setViewMode("camera");
  useWorkbenchStore.getState().setRigAdmissionIssues([]);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png);
  const stage = document.createElement("div");
  stage.id = "director-viewport";
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 360;
  stage.appendChild(canvas);
  document.body.appendChild(stage);
});
afterEach(() => {
  useWorkbenchStore.setState(initialState, true);
  document.querySelector("#director-viewport")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const capture = () => fireEvent.click(screen.getByRole("button", { name: "导出当前场景参考图" }));
const image = () => screen.getByRole("img", { name: /场景参考图/ });

it("exports the exact PNG with the same package and dimensions in a self-contained record", async () => {
  const expected = currentDirectorShotPackage(useWorkbenchStore.getState());
  const before = useWorkbenchStore.getState();
  render(<SceneReferencePanel />);
  capture();
  await waitFor(() => expect(image()).toHaveAttribute("src", png));
  const link = screen.getByRole("link", { name: "下载参考记录 JSON" });
  const record = JSON.parse(decodeURIComponent(link.getAttribute("href")!.split(",")[1]));
  expect(record.shotPackage).toEqual(expected);
  expect(record.image).toEqual({ dataUrl: png, width: 640, height: 360 });
  expect(record.limitations.join(" ")).toContain("不是米制深度结果");
  expect(screen.getByRole("link", { name: "下载场景 PNG" })).toHaveAttribute("href", png);
  expect(useWorkbenchStore.getState()).toBe(before);
});

it("keeps old pixels and record when settings change or recapture fails", async () => {
  render(<SceneReferencePanel />);
  capture();
  await waitFor(() => expect(image()).toBeInTheDocument());
  const oldRecord = screen.getByRole("link", { name: "下载参考记录 JSON" }).getAttribute("href");
  act(() => useWorkbenchStore.getState().setSkyColor("#112233"));
  expect(screen.getByRole("status")).toHaveTextContent("旧版本");
  vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(() => { throw new Error("画布不可读取"); });
  capture();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("画布不可读取"));
  expect(image()).toHaveAttribute("src", png);
  expect(screen.getByRole("link", { name: "下载参考记录 JSON" })).toHaveAttribute("href", oldRecord);
});

it("rejects director view without changing authoring state", async () => {
  useWorkbenchStore.getState().setViewMode("director");
  render(<SceneReferencePanel />);
  capture();
  expect(screen.getByRole("alert")).toHaveTextContent("切换到机位视图");
  expect(useWorkbenchStore.getState().viewMode).toBe("director");
  expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
});

it("rejects a frame changed while waiting for the canvas", async () => {
  render(<SceneReferencePanel />);
  capture();
  act(() => useWorkbenchStore.getState().setPlayheadFrame(12));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("截图期间"));
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("rejects missing canvas and unloaded white models", async () => {
  document.querySelector("#director-viewport")?.remove();
  const view = render(<SceneReferencePanel />);
  capture();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("三维舞台尚未就绪"));
  act(() => useWorkbenchStore.setState({ rigAdmissionStatus: "pending" }));
  capture();
  expect(screen.getByRole("alert")).toHaveTextContent("白模尚未加载完成");
  view.unmount();
});

it("rejects a selected panorama that has not been admitted or loaded", () => {
  const state = useWorkbenchStore.getState();
  useWorkbenchStore.setState({ renderScene: { ...state.renderScene, panorama: { ...state.renderScene.panorama, inputId: "missing-panorama" } } });
  render(<SceneReferencePanel />);
  capture();
  expect(screen.getByRole("alert")).toHaveTextContent("全景背景尚未就绪");
  expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
});

it("does not read the canvas after unmount during capture", async () => {
  const view = render(<SceneReferencePanel />);
  capture();
  view.unmount();
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
});
