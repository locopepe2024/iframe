import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useWorkbenchStore } from "../state/workbench-store";
import { WhiteModelVideoRecorder } from "./WhiteModelVideoRecorder";
import { recordWhiteModelVideo } from "./record-white-model-video";

vi.mock("./record-white-model-video", () => ({ recordWhiteModelVideo: vi.fn() }));

const initialState = useWorkbenchStore.getState();

afterEach(() => {
  useWorkbenchStore.setState(initialState, true);
  document.querySelector("#director-viewport")?.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("records the camera view and restores the original view and playhead", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:director-test"), revokeObjectURL: vi.fn() });
  const stage = document.createElement("div");
  stage.id = "director-viewport";
  stage.appendChild(document.createElement("canvas"));
  document.body.appendChild(stage);
  act(() => {
    useWorkbenchStore.getState().setRigAdmissionIssues([]);
    useWorkbenchStore.getState().setViewMode("top");
    useWorkbenchStore.getState().setPlayheadFrame(12);
  });
  vi.mocked(recordWhiteModelVideo).mockImplementation(async (options) => {
    expect(useWorkbenchStore.getState().viewMode).toBe("camera");
    expect(options.source).toBe(stage.querySelector("canvas"));
    options.setFrame(2);
    options.onProgress(2);
    return { blob: new Blob(["video"], { type: "video/webm" }), extension: "webm" };
  });
  const setRecording = vi.fn();
  const stopPlayback = vi.fn();
  const view = render(<WhiteModelVideoRecorder recording={false} setRecording={setRecording} stopPlayback={stopPlayback} />);
  fireEvent.click(screen.getByRole("button", { name: "录制白模视频" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute("download", "director-reference.webm"));
  expect(screen.getByRole("dialog", { name: "白模运镜参考视频" }).querySelector("video")).toHaveAttribute("src", "blob:director-test");
  fireEvent.click(screen.getByRole("button", { name: "关闭视频预览" }));
  expect(screen.queryByRole("dialog", { name: "白模运镜参考视频" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看视频" }));
  expect(screen.getByRole("dialog", { name: "白模运镜参考视频" })).toBeInTheDocument();
  expect(useWorkbenchStore.getState().viewMode).toBe("top");
  expect(useWorkbenchStore.getState().playheadFrame).toBe(12);
  expect(stopPlayback).toHaveBeenCalledOnce();
  expect(setRecording).toHaveBeenCalledWith(true);
  expect(setRecording).toHaveBeenCalledWith(false);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:director-test");
});

it("cancels recording and restores the view without a result", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  const stage = document.createElement("div");
  stage.id = "director-viewport";
  stage.appendChild(document.createElement("canvas"));
  document.body.appendChild(stage);
  act(() => {
    useWorkbenchStore.getState().setRigAdmissionIssues([]);
    useWorkbenchStore.getState().setViewMode("director");
  });
  vi.mocked(recordWhiteModelVideo).mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  }));
  const setRecording = vi.fn();
  const view = render(<WhiteModelVideoRecorder recording={false} setRecording={setRecording} stopPlayback={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "录制白模视频" }));
  await waitFor(() => expect(recordWhiteModelVideo).toHaveBeenCalledOnce());
  view.rerender(<WhiteModelVideoRecorder recording setRecording={setRecording} stopPlayback={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "停止录制" }));
  await waitFor(() => expect(setRecording).toHaveBeenCalledWith(false));
  expect(useWorkbenchStore.getState().viewMode).toBe("director");
  expect(screen.queryByRole("dialog", { name: "白模运镜参考视频" })).not.toBeInTheDocument();
});
