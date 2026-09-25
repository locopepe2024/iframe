import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "./App";
import DirectorWorkbench from "./DirectorWorkbench";
import { POSE_PRESETS } from "./pose/pose-presets";
import { humanoidUrl } from "./data/humanoid";
import { useWorkbenchStore } from "./state/workbench-store";
import { DIRECTOR_DRAFT_STORAGE_KEY } from "./state/local-draft";
import { parseLocalAnimationManifest } from "./state/local-animation-import";
import { CHARACTER_A_ID, CHARACTER_B_ID, CHARACTER_C_ID } from "./data/humanoid";
import { evaluateDirectorFrame } from "./timeline/timeline-evaluation";
import localAnimationExample from "../../../../docs/examples/director3d/local-animation-fight-15s.json";

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
it("uses the compact director checkbox contract for authoring toggles", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("tab", { name: "路径事件" }));
  expect(screen.getByRole("checkbox", { name: "写入导出标记" })).toHaveClass("director-checkbox");
  fireEvent.click(screen.getByRole("tab", { name: "镜头视图" }));
  for (const name of [
    "女性运动服白模 A",
    "女性运动服白模 B",
    "三分法",
    "中心十字",
    "安全区",
  ]) {
    expect(screen.getByRole("checkbox", { name })).toHaveClass("director-checkbox");
  }
  fireEvent.click(screen.getByRole("tab", { name: "噪声" }));
  expect(screen.getByRole("checkbox", { name: "启用噪声" })).toHaveClass("director-checkbox");
});
it("keeps camera authoring tools in a contextual inspector", () => {
  render(<App />);
  const stage = document.querySelector("#stage");
  expect(stage).not.toBeNull();
  expect(stage).not.toHaveTextContent("机位、构图与快照");
  expect(stage).not.toHaveTextContent("相机运动路径");
  expect(stage).not.toHaveTextContent("相机噪声轨道");
  expect(screen.queryByRole("complementary", { name: "镜头工具" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "镜头视图" }));
  expect(screen.getByRole("complementary", { name: "镜头工具" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "机位、构图与快照" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "相机运动路径" })).not.toBeInTheDocument();
  const compositionTab = screen.getByRole("tab", { name: "构图" });
  const motionTab = screen.getByRole("tab", { name: "运镜" });
  compositionTab.focus();
  fireEvent.keyDown(compositionTab, { key: "ArrowRight" });
  expect(motionTab).toHaveAttribute("aria-selected", "true");
  expect(motionTab).toHaveFocus();
  expect(screen.getByRole("heading", { name: "相机运动路径" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "机位、构图与快照" })).not.toBeInTheDocument();
});
it("keeps the timeline in a collapsible bottom dock", () => {
  render(<App />);
  const dock = document.querySelector(".timeline-dock");
  expect(dock).not.toBeNull();
  expect(dock?.querySelectorAll(".timeline-panel")).toHaveLength(1);
  expect(screen.getByRole("region", { name: "有界时间线" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "最小化" }));
  expect(dock?.querySelector(".timeline-panel")).toHaveClass("minimized");
  expect(document.getElementById("timeline-panel-content")).toHaveAttribute("hidden");
  expect(screen.getByRole("button", { name: "展开" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "展开" }));
  expect(dock?.querySelector('input[type="range"]')).not.toBeNull();
});
function validLocalAnimationManifest() {
  return {
    schemaVersion: "iframe.director3d.local-animation.v1",
    manifestId: "fight-take-01",
    title: "15 秒白模武打",
    durationSeconds: 15,
    fps: 30,
    source: { kind: "local", label: "fight-take-01.json" },
    tracks: [
      {
        trackId: "pose-a",
        trackKind: "character_pose",
        target: { characterId: "A" },
        propertyKey: "pose.normalized_values",
        keyframes: [
          { timeSeconds: 0, value: { root: [0, 0, 0] }, interpolation: "step" },
          { timeSeconds: 1, value: { root: [0, 12, 0] }, interpolation: "step" },
        ],
      },
      {
        trackId: "transform-b",
        trackKind: "character_transform",
        target: { characterId: CHARACTER_B_ID },
        propertyKey: "transform.position_m",
        keyframes: [
          { timeSeconds: 0, value: [1.2, 0, 0], interpolation: "bezier" },
          { timeSeconds: 15, value: [0.4, 0.1, 0], interpolation: "linear" },
        ],
      },
    ],
    limitations: ["本地白模预览；不生成 MP4"],
  };
}
it("validates local white-model animation manifests without network access", () => {
  const parsed = parseLocalAnimationManifest(validLocalAnimationManifest(), {
    availableCharacterIds: [CHARACTER_A_ID, CHARACTER_B_ID, CHARACTER_C_ID],
    sourceLabel: "fight-take-01.json",
  });
  expect(parsed.ok).toBe(true);
  expect(parsed.state.status).toBe("ready");
  expect(parsed.state.totalKeyframes).toBe(4);
  expect(parsed.state.characterMappings).toEqual([
    { requestedId: "A", characterId: CHARACTER_A_ID },
    { requestedId: CHARACTER_B_ID, characterId: CHARACTER_B_ID },
  ]);
  expect(parsed.state.tracks[0].target.targetId).toBe(CHARACTER_A_ID);
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps the committed local animation example inside the V1 contract", () => {
  const parsed = parseLocalAnimationManifest(localAnimationExample, {
    availableCharacterIds: [CHARACTER_A_ID, CHARACTER_B_ID, CHARACTER_C_ID],
  });
  expect(parsed.ok).toBe(true);
  expect(parsed.state.manifest?.manifestId).toBe("fight-take-15s");
  expect(parsed.state.totalKeyframes).toBe(16);
  expect(parsed.state.tracks).toHaveLength(4);
});
it("rejects unsupported local animation schemas and targets before mutation", () => {
  const manifest = validLocalAnimationManifest();
  manifest.schemaVersion = "iframe.director3d.local-animation.v0";
  const parsed = parseLocalAnimationManifest(manifest, { availableCharacterIds: [CHARACTER_A_ID, CHARACTER_B_ID] });
  expect(parsed.ok).toBe(false);
  expect(parsed.state.status).toBe("error");
  expect(parsed.state.errors[0]).toMatch(/schemaVersion/);
});
it("previews, applies, undoes, and redoes a local white-model animation", async () => {
  render(<App />);
  const before = useWorkbenchStore.getState().dialogueTimeline;
  fireEvent.click(screen.getByRole("button", { name: "导入白模动画" }));
  const input = screen.getByLabelText("选择本地白模动画 JSON 文件");
  const file = new File([JSON.stringify(validLocalAnimationManifest())], "fight-take-01.json", { type: "application/json" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(useWorkbenchStore.getState().localAnimationImport.status).toBe("ready"));
  expect(useWorkbenchStore.getState().dialogueTimeline).toBe(before);
  expect(screen.getByText("导入预览")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "应用到时间线" }));
  let state = useWorkbenchStore.getState();
  expect(state.localAnimationImport.status).toBe("applied");
  expect(state.dialogueTimeline.fps).toBe(30);
  expect(state.dialogueTimeline.durationSeconds).toBe(15);
  expect(state.dialogueTimeline.tracks.some((track) => track.trackId === "local-animation-fight-take-01-pose-a")).toBe(true);
  expect(state.commandHistory.at(-1)).toBe("timeline.local_animation_import");
  state.undo();
  expect(useWorkbenchStore.getState().dialogueTimeline).toBe(before);
  state = useWorkbenchStore.getState();
  state.redo();
  const appliedState = useWorkbenchStore.getState();
  expect(appliedState.dialogueTimeline.tracks.some((track) => track.trackId === "local-animation-fight-take-01-pose-a")).toBe(true);
  const evaluated = evaluateDirectorFrame({
    frame: 451,
    durationSeconds: appliedState.dialogueTimeline.durationSeconds,
    fps: appliedState.dialogueTimeline.fps,
    tracks: appliedState.dialogueTimeline.tracks,
    activeCameraTrackId: appliedState.dialogueTimeline.activeCameraTrackId,
    selectedCameraId: appliedState.selectedCameraId,
    characters: appliedState.characters,
    cameras: appliedState.cameras,
    sceneObjects: appliedState.sceneObjects,
    actorPaths: appliedState.actorPaths,
    cameraPaths: appliedState.cameraPaths,
  });
  expect(evaluated.characters[CHARACTER_B_ID].transform.position).toEqual([0.4, 0.1, 0]);
  expect(fetch).not.toHaveBeenCalled();
});
it("imports a frame manifest as a read-only reference without touching authored tracks", async () => {
  render(<App />);
  const before = useWorkbenchStore.getState().dialogueTimeline;
  fireEvent.click(screen.getByRole("tab", { name: "参考帧" }));
  const input = screen.getByLabelText("选择历史视频帧 manifest");
  const manifest = {
    schema_version: "recreation.frame-manifest.v1",
    manifest_id: "reviewed-fight-01",
    source_media_id: "source-video-01",
    source_checksum: "a".repeat(64),
    analysis_id: "analysis-01",
    time_base: "1/60000",
    source_start_pts: 1000,
    source_end_pts: 901000,
    duration_seconds: 15,
    review_state: "reviewed",
    frames: [
      { frame_id: "frame-a", source_pts: 242000, source_seconds: 4.016666666666667, evidence_media_id: "evidence-a", evidence_media_path: "/evidence-a.jpg", width: 1080, height: 1920, extraction_method: "manual" },
      { frame_id: "frame-b", source_pts: 546000, source_seconds: 9.083333333333334, evidence_media_id: "evidence-b", evidence_media_path: "/evidence-b.jpg", width: 1080, height: 1920, extraction_method: "detected" },
    ],
  };
  fireEvent.change(input, { target: { files: [new File([JSON.stringify(manifest)], "reviewed-fight-01.json", { type: "application/json" })] } });
  await waitFor(() => expect(useWorkbenchStore.getState().frameManifestImport.status).toBe("ready"));
  expect(useWorkbenchStore.getState().frameManifestImport.revision).toBe(1);
  expect(useWorkbenchStore.getState().dialogueTimeline).toBe(before);
  expect(screen.getByText("已审核参考")).toBeInTheDocument();
  expect(screen.getByText(/2 帧/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "应用到时间线" })).not.toBeInTheDocument();
  fireEvent.change(input, { target: { files: [new File(["{}"], "invalid.json", { type: "application/json" })] } });
  await waitFor(() => expect(screen.getByText("无法导入参考帧")).toBeInTheDocument());
  expect(useWorkbenchStore.getState().frameManifestImport.manifest?.manifest_id).toBe("reviewed-fight-01");
  expect(useWorkbenchStore.getState().frameManifestImport.revision).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "清除参考" }));
  expect(useWorkbenchStore.getState().frameManifestImport.status).toBe("idle");
  expect(useWorkbenchStore.getState().dialogueTimeline).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
});
it("previews an illustrative action before one undoable timeline application", () => {
  render(<App />);
  const before = useWorkbenchStore.getState().dialogueTimeline;
  fireEvent.click(screen.getByRole("tab", { name: "动作" }));
  fireEvent.change(screen.getByLabelText("动作描述"), { target: { value: "让 A 做一段鹤形拳" } });
  fireEvent.click(screen.getByRole("button", { name: "查找动作" }));
  expect(screen.getByText("鹤形拳（示意动作结构）")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "应用到时间线" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "预览动作" }));
  expect(screen.getByText(/待应用：5 段动作/)).toBeInTheDocument();
  expect(useWorkbenchStore.getState().dialogueTimeline).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "应用到时间线" }));
  const applied = useWorkbenchStore.getState();
  expect(applied.dialogueTimeline.tracks.filter((track) => track.trackId.startsWith("action-martial.hexingquan.blocking.v1"))).toHaveLength(2);
  expect(applied.dialogueTimeline.tracks.at(-2)?.keyframes).toHaveLength(6);
  expect(applied.undoStack).toHaveLength(1);
  expect(applied.commandHistory.at(-1)).toContain("timeline.action.apply.martial.hexingquan.blocking.v1");
  applied.undo();
  expect(useWorkbenchStore.getState().dialogueTimeline).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
});
it("adds an optional contact candidate only for an existing opponent", () => {
  const before = useWorkbenchStore.getState().dialogueTimeline;
  useWorkbenchStore.getState().applyActionStructure({ actionId: "martial.hexingquan.blocking.v1", characterId: CHARACTER_A_ID, opponentId: "missing", startSeconds: 0, durationSeconds: 15, includeContact: true });
  expect(useWorkbenchStore.getState().dialogueTimeline).toBe(before);
  useWorkbenchStore.getState().applyActionStructure({ actionId: "martial.hexingquan.blocking.v1", characterId: CHARACTER_A_ID, opponentId: CHARACTER_B_ID, startSeconds: 0, durationSeconds: 15, includeContact: true });
  const applied = useWorkbenchStore.getState().dialogueTimeline;
  expect(applied.interactionAnchors).toHaveLength(1);
  expect(applied.interactionAnchors[0]).toMatchObject({ jointId: "wrist_r", startSeconds: 9, endSeconds: 12, contactTarget: { targetId: CHARACTER_B_ID }, limitation: "reference_constraint_not_physics" });
  useWorkbenchStore.getState().undo();
  expect(useWorkbenchStore.getState().dialogueTimeline).toBe(before);
});
it("loads deterministic indoor and fight validation scenes without external requests", () => {
  render(<App />);
  fireEvent.click(document.querySelector(".validation-scene-menu > summary")!);
  fireEvent.click(screen.getByRole("button", { name: /室内沙发三人全景/ }));
  let state = useWorkbenchStore.getState();
  expect(Object.values(state.characters)).toHaveLength(3);
  expect(Object.values(state.characters).filter((character) => character.visible)).toHaveLength(3);
  expect(Object.values(state.characters).every((character) => character.activePresetId === "seated.sit")).toBe(true);
  expect(Object.values(state.sceneObjects).some((sceneObject) => sceneObject.label === "沙发座面白模")).toBe(true);
  expect(state.dialogueTimeline.durationSeconds).toBe(6);
  expect(state.cameras["camera-main"].compositionPresetId).toBe("wide");
  fireEvent.click(document.querySelector(".validation-scene-menu > summary")!);
  fireEvent.click(screen.getByRole("button", { name: /15 秒武打参考/ }));
  state = useWorkbenchStore.getState();
  expect(state.dialogueTimeline.durationSeconds).toBe(15);
  const poseTracks = state.dialogueTimeline.tracks.filter((track) => track.trackKind === "character_pose");
  expect(poseTracks).toHaveLength(2);
  expect(poseTracks.every((track) => track.keyframes)).toBe(true);
  expect(poseTracks.every((track) => track.keyframes.length === 6)).toBe(true);
  expect(state.pathEvents).toHaveLength(1);
  expect(state.pathEvents[0].exportMarker).toBe(true);
  expect(state.characters["character-female-c001"].visible).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it("collapses configuration surfaces without discarding local drafts", () => {
  render(<App />);
  const sceneToggle = screen.getByRole("button", { name: "收起场景配置" });
  fireEvent.click(sceneToggle);
  expect(sceneToggle).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById("left-panel-content")).toHaveAttribute("hidden");
  expect(screen.getByRole("button", { name: "展开场景配置" })).toBeInTheDocument();
  const inspectorToggle = screen.getByRole("button", { name: "收起属性配置" });
  fireEvent.click(inspectorToggle);
  expect(inspectorToggle).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById("inspector-column-content")).toHaveAttribute("hidden");
  const temporalToggle = screen.getByRole("button", { name: "收起时间工具" });
  fireEvent.change(screen.getByRole("textbox", { name: "对白文本" }), { target: { value: "折叠后仍保留" } });
  temporalToggle.focus();
  fireEvent.click(temporalToggle);
  expect(temporalToggle).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById("temporal-tools-content")).toHaveAttribute("hidden");
  fireEvent.click(screen.getByRole("button", { name: "展开时间工具" }));
  expect(screen.getByRole("textbox", { name: "对白文本" })).toHaveValue("折叠后仍保留");
  expect(screen.getByRole("button", { name: "收起时间工具" })).toHaveFocus();
});
it("groups temporal tools into an accessible context panel", () => {
  render(<App />);
  const dialogueTab = screen.getByRole("tab", { name: "对白" });
  const focusTab = screen.getByRole("tab", { name: "焦点" });
  const interactionTab = screen.getByRole("tab", { name: "接触" });
  const temporalTools = document.querySelector(".temporal-tools");
  expect(screen.getByRole("tablist", { name: "时间工具" })).toBeInTheDocument();
  expect(temporalTools?.querySelectorAll('[role="tabpanel"]').length).toBe(1);
  expect(dialogueTab).toHaveAttribute("aria-selected", "true");
  expect(dialogueTab).toHaveAttribute("aria-controls", "temporal-tool-panel-dialogue");
  expect(focusTab).toHaveAttribute("aria-controls", "temporal-tool-panel-focus");
  expect(screen.getByRole("heading", { name: "对白与说话人" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "叙事焦点轨道" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "对白文本" }), { target: { value: "保留中的对白草稿" } });
  fireEvent.click(focusTab);
  expect(focusTab).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("heading", { name: "叙事焦点轨道" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "对白与说话人" })).not.toBeInTheDocument();
  focusTab.focus();
  fireEvent.keyDown(focusTab, { key: "ArrowRight" });
  expect(interactionTab).toHaveAttribute("aria-selected", "true");
  expect(interactionTab).toHaveFocus();
  fireEvent.click(dialogueTab);
  expect(screen.getByRole("textbox", { name: "对白文本" })).toHaveValue("保留中的对白草稿");
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
