import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { useWorkbenchStore } from "../state/workbench-store";
import { directorDesignApi } from "@/lib/directorDesign";
import { designRevision, type DesignPreview, type DesignProposal } from "./design-proposal";

vi.mock("@/lib/directorDesign", () => ({ directorDesignApi: { propose: vi.fn() } }));
vi.mock("@/lib/panoramaAssets", () => ({ panoramaAssetApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../scene/HumanoidStage", () => ({ HumanoidStage: ({ preview, previewFrame }: { preview?: DesignPreview | null; previewFrame?: number }) => <div data-testid="stage-design-state" data-preview-frame={previewFrame}>{preview ? JSON.stringify(preview.cameras[preview.cameraId].transform.position) : "authored"}</div> }));

const initial = useWorkbenchStore.getState();
beforeEach(() => {
  useWorkbenchStore.setState(initial, true);
  const state = useWorkbenchStore.getState();
  useWorkbenchStore.setState({ playheadFrame: 1, actorPaths: {}, cameraPaths: {}, dialogueTimeline: { ...state.dialogueTimeline, tracks: [], activeCameraTrackId: null } });
  vi.resetAllMocks();
});
afterEach(() => { useWorkbenchStore.setState(initial, true); vi.restoreAllMocks(); });
function proposal(): DesignProposal {
  const state = useWorkbenchStore.getState();
  return { schemaVersion: "iframe.director3d.design-proposal.v1", baseRevision: designRevision(state), summary: "从六米外拍摄当前人物", assumptions: ["未指定距离，使用六米"], clarification: null,
    operations: [{ kind: "frame_camera", cameraId: state.selectedCameraId, targetIds: [state.selectedCharacterId], azimuthDeg: 0, elevationDeg: 5, distanceM: 6, focalLengthMm: 35 }] };
}
async function generate(text = "用35mm拍摄当前人物") {
  fireEvent.change(screen.getByRole("textbox", { name: "设计要求" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "生成设计提案" }));
  await screen.findByRole("button", { name: "预览设计" });
}

it("previews without store mutation, gates exports and applies in one undoable transaction", async () => {
  const before = useWorkbenchStore.getState();
  vi.mocked(directorDesignApi.propose).mockResolvedValue(proposal());
  render(<App />);
  await generate();
  expect(screen.getByRole("button", { name: "应用设计" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "预览设计" }));
  expect(screen.getByTestId("stage-design-state")).not.toHaveTextContent("authored");
  expect(useWorkbenchStore.getState().cameras).toBe(before.cameras);
  expect(useWorkbenchStore.getState().undoStack.length).toBe(before.undoStack.length);
  expect(screen.queryByRole("tab", { name: "占位图" })).not.toBeInTheDocument();
  expect(screen.getByText(/设计预览期间暂不可导出/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "应用设计" }));
  expect(screen.getByTestId("stage-design-state")).toHaveTextContent("authored");
  expect(useWorkbenchStore.getState().cameras[before.selectedCameraId].focalLengthMm).toBe(35);
  expect(useWorkbenchStore.getState().undoStack.length).toBe(before.undoStack.length + 1);
  act(() => useWorkbenchStore.getState().undo());
  expect(useWorkbenchStore.getState().cameras).toEqual(before.cameras);
});

it("cancels the visual override and removes it immediately when editing invalidates the proposal", async () => {
  vi.mocked(directorDesignApi.propose).mockResolvedValue(proposal());
  render(<App />);
  await generate();
  fireEvent.click(screen.getByRole("button", { name: "预览设计" }));
  fireEvent.click(screen.getByRole("button", { name: "退出预览" }));
  expect(screen.getByTestId("stage-design-state")).toHaveTextContent("authored");
  fireEvent.click(screen.getByRole("button", { name: "预览设计" }));
  act(() => useWorkbenchStore.getState().setSkyColor("#223344"));
  expect(screen.getByTestId("stage-design-state")).toHaveTextContent("authored");
  expect(screen.getByRole("button", { name: "应用设计" })).toBeDisabled();
  expect(screen.getByText(/此提案已过期/)).toBeInTheDocument();
});

it("scrubs a motion candidate without changing authored time or invalidating apply", async () => {
  const before = useWorkbenchStore.getState();
  vi.mocked(directorDesignApi.propose).mockResolvedValue({ ...proposal(), operations: [{ kind: "camera_motion", cameraId: before.selectedCameraId, presetId: "push_in", durationSeconds: 4, easing: "ease_in_out", distanceM: .5 }] });
  render(<App />);
  await generate("四秒推进半米");
  fireEvent.click(screen.getByRole("button", { name: "预览设计" }));
  const frame = before.dialogueTimeline.fps * 2 + 1;
  fireEvent.change(screen.getByRole("slider", { name: "运镜预览时间" }), { target: { value: String(frame) } });
  expect(screen.getByTestId("stage-design-state")).toHaveAttribute("data-preview-frame", String(frame));
  expect(useWorkbenchStore.getState().playheadFrame).toBe(1);
  expect(useWorkbenchStore.getState().cameraPaths).toEqual({});
  expect(screen.getByRole("button", { name: "应用设计" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "退出预览" }));
  fireEvent.click(screen.getByRole("button", { name: "预览设计" }));
  expect(screen.getByRole("slider", { name: "运镜预览时间" })).toHaveValue("1");
});

it("sends current context and conversation on subsequent edits and keeps the proposal on provider failure", async () => {
  vi.mocked(directorDesignApi.propose).mockResolvedValueOnce(proposal()).mockRejectedValueOnce(new Error("服务暂不可用"));
  render(<App />);
  await generate();
  const previous = useWorkbenchStore.getState();
  fireEvent.change(screen.getByRole("textbox", { name: "设计要求" }), { target: { value: "只拉近半米" } });
  fireEvent.click(screen.getByRole("button", { name: "生成设计提案" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("服务暂不可用"));
  expect(screen.getByText("从六米外拍摄当前人物")).toBeInTheDocument();
  expect(useWorkbenchStore.getState().cameras).toBe(previous.cameras);
  const args = vi.mocked(directorDesignApi.propose).mock.calls[1][0];
  expect(args.history).toHaveLength(2);
  expect(args.prompt).toBe("只拉近半米");
  expect(args.baseRevision).toBe(designRevision(useWorkbenchStore.getState()));
  expect(JSON.parse(args.context).cameras).toEqual(previous.cameras);
});

it("displays clarification without an apply action and can cancel a pending generation", async () => {
  const first = { ...proposal(), operations: [], clarification: "请选择需要摆位的两个人物。" };
  vi.mocked(directorDesignApi.propose).mockResolvedValueOnce(first);
  const view = render(<App />);
  fireEvent.change(screen.getByRole("textbox", { name: "设计要求" }), { target: { value: "安排两个人" } });
  fireEvent.click(screen.getByRole("button", { name: "生成设计提案" }));
  await screen.findByText(first.clarification);
  expect(screen.queryByRole("button", { name: "应用设计" })).not.toBeInTheDocument();
  vi.mocked(directorDesignApi.propose).mockImplementationOnce((_request, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })));
  fireEvent.change(screen.getByRole("textbox", { name: "设计要求" }), { target: { value: "重试" } });
  fireEvent.click(screen.getByRole("button", { name: "生成设计提案" }));
  fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
  await screen.findByText("已停止生成，当前场景未修改。");
  expect(screen.getByRole("button", { name: "生成设计提案" })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  view.unmount();
});
