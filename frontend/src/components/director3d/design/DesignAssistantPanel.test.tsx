import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { useWorkbenchStore } from "../state/workbench-store";
import { directorDesignApi } from "@/lib/directorDesign";
import { compileDesignProposal, designRevision, type DesignPreview, type DesignProposal } from "./design-proposal";

vi.mock("@/lib/directorDesign", () => ({ directorDesignApi: { propose: vi.fn(), listReferenceAssets: vi.fn(), readReferenceAsset: vi.fn() } }));
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

it("scrubs a crowd-only candidate and applies group membership without requiring a camera path", async () => {
  act(() => useWorkbenchStore.setState({rigAdmissionStatus: "passed"}));
  const before = useWorkbenchStore.getState();
  vi.mocked(directorDesignApi.propose).mockResolvedValue({...proposal(), operations: [{kind: "crowd_motion", groupId: "design-crowd-near", label: "近处百姓", behavior: "avoid",
    members: [{actorId: "design-extra-near", positionM: [-5, 2, 0], destinationM: [-3, 2, 0], yawDeg: -90, startSeconds: 1, durationSeconds: 4}]}]});
  render(<App />);
  await generate("近处一位百姓一秒后向侧面避让");
  fireEvent.click(screen.getByRole("button", { name: "预览设计" }));
  fireEvent.change(screen.getByRole("slider", { name: "运镜预览时间" }), {target: {value: "49"}});
  expect(useWorkbenchStore.getState().characters).toBe(before.characters);
  expect(useWorkbenchStore.getState().playheadFrame).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "应用设计" }));
  expect(useWorkbenchStore.getState().crowdGroups["design-crowd-near"].actorIds).toEqual(["design-extra-near"]);
  expect(useWorkbenchStore.getState().dialogueTimeline.tracks[0].trackKind).toBe("character_transform");
});

const savedAsset = { mediaId: "saved-layout", kind: "design_bundle" as const, name: "粮铺布局.json", sha256: "a".repeat(64), metadata: { sourcePackageChecksum: "fnv1a32:12345678" } };
async function chooseSavedDesign() {
  fireEvent.click(screen.getByRole("button", { name: "读取已保存的设计" }));
  const picker = await screen.findByRole("combobox", { name: "已保存的 3D 设计" });
  fireEvent.change(picker, { target: { value: savedAsset.mediaId } });
  fireEvent.click(screen.getByRole("button", { name: "导入所选设计" }));
}

it("opens a saved design from the library with its provenance and supports undo", async () => {
  useWorkbenchStore.getState().setSkyColor("#223344");
  const bundle = useWorkbenchStore.getState().exportDirectorDesignBundle();
  bundle.authoring.designAssumptions = ["粮铺尺度待校正"];
  useWorkbenchStore.getState().setSkyColor("#556677");
  const before = useWorkbenchStore.getState();
  vi.mocked(directorDesignApi.listReferenceAssets).mockResolvedValue([savedAsset, { ...savedAsset, mediaId: "image", kind: "reference_image", name: "source.png" }]);
  vi.mocked(directorDesignApi.readReferenceAsset).mockResolvedValue(new Blob([JSON.stringify(bundle)]));
  render(<App />);
  await chooseSavedDesign();
  await screen.findByText(/已从素材库导入设计/);
  expect(screen.queryByRole("option", { name: "source.png" })).not.toBeInTheDocument();
  expect(directorDesignApi.readReferenceAsset).toHaveBeenCalledWith(savedAsset.mediaId);
  expect(useWorkbenchStore.getState().designAssumptions).toEqual(["粮铺尺度待校正"]);
  expect(useWorkbenchStore.getState().undoStack.length).toBe(before.undoStack.length + 1);
  act(() => useWorkbenchStore.getState().undo());
  expect(useWorkbenchStore.getState().renderScene.skyColor).toBe(before.renderScene.skyColor);
});

it("keeps edits made while a saved design is being fetched", async () => {
  const bundle = useWorkbenchStore.getState().exportDirectorDesignBundle();
  let resolve!: (blob: Blob) => void;
  vi.mocked(directorDesignApi.listReferenceAssets).mockResolvedValue([savedAsset]);
  vi.mocked(directorDesignApi.readReferenceAsset).mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<App />);
  await chooseSavedDesign();
  act(() => useWorkbenchStore.getState().setSkyColor("#123456"));
  const edited = useWorkbenchStore.getState();
  await act(async () => resolve(new Blob([JSON.stringify(bundle)])));
  await screen.findByText("读取期间场景已变化，请重新导入。");
  expect(useWorkbenchStore.getState().renderScene.skyColor).toBe("#123456");
  expect(useWorkbenchStore.getState().undoStack).toBe(edited.undoStack);
});

it("reports invalid saved content without changing the scene", async () => {
  const before = useWorkbenchStore.getState();
  vi.mocked(directorDesignApi.listReferenceAssets).mockResolvedValue([savedAsset]);
  vi.mocked(directorDesignApi.readReferenceAsset).mockResolvedValue(new Blob(['{"schemaVersion":"unknown"}']));
  render(<App />);
  await chooseSavedDesign();
  await screen.findByRole("alert");
  expect(useWorkbenchStore.getState().characters).toBe(before.characters);
  expect(useWorkbenchStore.getState().undoStack).toBe(before.undoStack);
});

it("clears blocking animation as one undoable action and enables a new camera motion", async () => {
  const defaults = initial;
  useWorkbenchStore.setState({ actorPaths: defaults.actorPaths, rigAdmissionStatus: "passed" });
  const before = useWorkbenchStore.getState();
  const request = { ...proposal(), operations: [{ kind: "camera_motion" as const, cameraId: before.selectedCameraId, presetId: "push_in" as const, durationSeconds: 4, easing: "ease_in_out" as const, distanceM: .5 }] };
  expect(() => compileDesignProposal(before, request)).toThrow("不能已有动画");
  render(<App />);
  fireEvent.click(screen.getByText("重新编排动画"));
  fireEvent.click(screen.getByRole("button", { name: "清除动画，保留布局" }));
  const clean = useWorkbenchStore.getState();
  expect(clean.actorPaths).toEqual({});
  expect(clean.characters).toBe(before.characters);
  expect(clean.sceneObjects).toBe(before.sceneObjects);
  expect(clean.cameras).toBe(before.cameras);
  expect(clean.designSource).toBe(before.designSource);
  expect(clean.dialogueTimeline.fps).toBe(before.dialogueTimeline.fps);
  expect(clean.dialogueTimeline.durationSeconds).toBe(before.dialogueTimeline.durationSeconds);
  expect(compileDesignProposal(clean, { ...request, baseRevision: designRevision(clean) }).cameraPaths).not.toEqual({});
  const crowd = { ...request, baseRevision: designRevision(clean), operations: [{ kind: "crowd_motion" as const, groupId: "design-crowd-reset", label: "近处避让", behavior: "avoid" as const,
    members: [{ actorId: "design-extra-reset", positionM: [-5, 3, 0] as [number, number, number], destinationM: [-3, 3, 0] as [number, number, number], yawDeg: -90, startSeconds: 0, durationSeconds: 4 }] }] };
  expect(compileDesignProposal(clean, crowd).crowdGroups["design-crowd-reset"].actorIds).toEqual(["design-extra-reset"]);
  act(() => clean.undo());
  expect(useWorkbenchStore.getState().actorPaths).toEqual(before.actorPaths);
  expect(useWorkbenchStore.getState().dialogueTimeline).toEqual(before.dialogueTimeline);
  act(() => useWorkbenchStore.getState().redo());
  expect(useWorkbenchStore.getState().actorPaths).toEqual({});
});

function overlappingStreet(): DesignProposal {
  return { ...proposal(), operations: [{kind: "street_layout", layoutId: "design-street-invalid", centerM: [0,0,0], widthM: 6, lengthM: 12,
    buildings: [{id: "shop", label: "粮铺", centerM: [0,0,0], dimensionsM: [6,6,4], doorWidthM: 2, frontSide: "negative_x"}], trees: []}] };
}
it("returns rejected spatial geometry and its validation reason on the next user request", async () => {
  const bad = overlappingStreet();
  const before = useWorkbenchStore.getState();
  vi.mocked(directorDesignApi.propose).mockResolvedValueOnce(bad).mockResolvedValueOnce(proposal());
  render(<App />);
  await generate("按参考图建立粮铺");
  fireEvent.click(screen.getByRole("button", {name: "预览设计"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("建筑占地与道路或其他建筑重叠");
  expect(useWorkbenchStore.getState().sceneObjects).toBe(before.sceneObjects);
  expect(useWorkbenchStore.getState().undoStack).toBe(before.undoStack);
  await generate("把粮铺移到道路右侧");
  await waitFor(() => expect(directorDesignApi.propose).toHaveBeenCalledTimes(2));
  const context = JSON.parse(vi.mocked(directorDesignApi.propose).mock.calls[1][0].context);
  expect(context.rejectedDesign.operations).toEqual(bad.operations);
  expect(context.rejectedDesign.reason).toContain("建筑占地与道路或其他建筑重叠");
});
it("does not attach rejected geometry after the scene revision changes", async () => {
  vi.mocked(directorDesignApi.propose).mockResolvedValueOnce(overlappingStreet()).mockResolvedValueOnce(proposal());
  render(<App />);
  await generate();
  fireEvent.click(screen.getByRole("button", {name: "预览设计"}));
  await screen.findByRole("alert");
  act(() => useWorkbenchStore.getState().setSkyColor("#123456"));
  await generate("重新设计");
  await waitFor(() => expect(directorDesignApi.propose).toHaveBeenCalledTimes(2));
  expect(JSON.parse(vi.mocked(directorDesignApi.propose).mock.calls[1][0].context)).not.toHaveProperty("rejectedDesign");
});
