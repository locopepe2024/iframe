import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useWorkbenchStore } from "../state/workbench-store";
import { WhiteModelVideoRecorder } from "./WhiteModelVideoRecorder";
import { recordWhiteModelVideo } from "./record-white-model-video";
import { directorDesignApi } from "@/lib/directorDesign";

vi.mock("./record-white-model-video", () => ({ recordWhiteModelVideo: vi.fn() }));
vi.mock("@/lib/directorDesign", () => ({ directorDesignApi: { saveReferenceAsset: vi.fn() } }));

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
  act(() => useWorkbenchStore.getState().setCameraTransformAxis("camera-main", "position", 0, 2));
  expect(screen.getAllByText(/当前导演设置已变化/)).toHaveLength(2);
  expect(screen.getByRole("button", { name: "保存视频到素材库" })).toBeDisabled();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:director-test");
});

it("saves the exact recorded video with its design bundle and checksum", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:director-test"), revokeObjectURL: vi.fn() });
  const stage = document.createElement("div"); stage.id = "director-viewport";
  const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
  stage.appendChild(canvas); document.body.appendChild(stage);
  act(() => useWorkbenchStore.getState().setRigAdmissionIssues([]));
  const blob = new Blob(["video"], { type: "video/webm" });
  vi.mocked(recordWhiteModelVideo).mockResolvedValue({ blob, extension: "webm" });
  vi.mocked(directorDesignApi.saveReferenceAsset).mockResolvedValueOnce({ mediaId: "bundle-1", kind: "design_bundle", sourcePackageChecksum: "fnv1a32:00000000" }).mockResolvedValueOnce({ mediaId: "video-1", kind: "camera_motion_video", sourcePackageChecksum: "fnv1a32:00000000" });
  render(<WhiteModelVideoRecorder recording={false} setRecording={vi.fn()} stopPlayback={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "录制白模视频" }));
  await screen.findByRole("button", { name: "保存视频到素材库" });
  fireEvent.click(screen.getByRole("button", { name: "保存视频到素材库" }));
  await screen.findByText("素材 ID video-1");
  const calls = vi.mocked(directorDesignApi.saveReferenceAsset).mock.calls;
  expect(calls[0][2]).toBe("design_bundle");
  expect(calls[1][0]).toBe(blob);
  expect(calls[1][2]).toBe("camera_motion_video");
  expect(calls[1][3]).toBe(calls[0][3]);
  expect(calls[1][4]).toMatchObject({ designBundleMediaId: "bundle-1" });
});

it("rejects a timeline cut to a camera with a different aspect ratio", async () => {
  act(() => {
    const state = useWorkbenchStore.getState();
    state.setRigAdmissionIssues([]);
    useWorkbenchStore.setState({
      cameras: { ...state.cameras, "camera-vertical": { ...state.cameras["camera-main"], cameraId: "camera-vertical", aspectRatio: "9:16" } },
      dialogueTimeline: { ...state.dialogueTimeline, tracks: [{ trackId: "camera-cut", trackKind: "active_camera", target: { targetType: "timeline", targetId: state.dialogueTimeline.timelineId }, propertyKey: "activeCameraId", keyframes: [{ keyframeId: "cut-1", timeSeconds: 0, value: "camera-main", interpolation: "step" }, { keyframeId: "cut-2", timeSeconds: 1, value: "camera-vertical", interpolation: "step" }] }], activeCameraTrackId: "camera-cut" },
    });
  });
  render(<WhiteModelVideoRecorder recording={false} setRecording={vi.fn()} stopPlayback={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "录制白模视频" }));
  expect(screen.getByRole("alert")).toHaveTextContent("不同画幅");
  expect(recordWhiteModelVideo).not.toHaveBeenCalled();
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
