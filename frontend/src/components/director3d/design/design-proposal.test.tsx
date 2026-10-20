import { afterEach, beforeEach, expect, it } from "vitest";
import { useWorkbenchStore } from "../state/workbench-store";
import { compileDesignProposal, designContext, designRevision, parseDesignProposal, type DesignOperation, type DesignProposal } from "./design-proposal";
import { cameraRuntime } from "../timeline/timeline-evaluation";

const initial = useWorkbenchStore.getState();
beforeEach(() => {
  useWorkbenchStore.setState(initial, true);
  if (Object.keys(initial.characters).length < 2) useWorkbenchStore.getState().addWhiteModelCharacter();
  const state = useWorkbenchStore.getState();
  useWorkbenchStore.setState({ playheadFrame: 1, actorPaths: {}, cameraPaths: {}, dialogueTimeline: { ...state.dialogueTimeline, tracks: [], activeCameraTrackId: null } });
});
afterEach(() => useWorkbenchStore.setState(initial, true));
function plan(operations: DesignOperation[]): DesignProposal {
  return { schemaVersion: "iframe.director3d.design-proposal.v1", baseRevision: designRevision(useWorkbenchStore.getState()), summary: "双人机位设计", assumptions: ["人物间隔三米"], clarification: null, operations };
}
function fixture() {
  const state = useWorkbenchStore.getState(), ids = Object.keys(state.characters).slice(0, 2) as [string, string];
  const proposal = plan([
    { kind: "arrange_pair", actorIds: ids, centerM: [0, 0, 0], separationM: 3, axisDeg: 0 },
    { kind: "add_box", entityId: "design-box-table", label: "桌子", positionM: [0, 0, 0], dimensionsM: [1.2, .8, .75] },
    { kind: "frame_camera", cameraId: state.selectedCameraId, targetIds: ids, azimuthDeg: 0, elevationDeg: 5, distanceM: 6, focalLengthMm: 35 },
  ]);
  return { state, ids, proposal };
}

it("compiles a pair and prop with deterministic facing and a 35mm camera without mutating state", () => {
  const { state, ids, proposal } = fixture();
  const preview = compileDesignProposal(state, proposal);
  expect(useWorkbenchStore.getState()).toBe(state);
  expect(preview.characters[ids[0]].transform.position).toEqual([-1.5, 0, 0]);
  expect(preview.characters[ids[1]].transform.position).toEqual([1.5, 0, 0]);
  expect(preview.characters[ids[0]].transform.rotationDeg[2]).toBe(-90);
  expect(preview.characters[ids[1]].transform.rotationDeg[2]).toBe(90);
  expect(preview.sceneObjects["design-box-table"].label).toContain("占位");
  expect(preview.cameras[state.selectedCameraId].focalLengthMm).toBe(35);
  expect(cameraRuntime(preview.cameras[state.selectedCameraId], preview.characters, preview.sceneObjects).targetM).toEqual([0, 0, 1]);
  preview.characters[ids[0]].transform.position[0] = 99;
  expect(state.characters[ids[0]].transform.position[0]).not.toBe(99);
});

it("applies once and undo/redo restores the complete scene", () => {
  const { state, proposal } = fixture();
  state.applyDesignProposal(proposal);
  const applied = useWorkbenchStore.getState();
  expect(applied.undoStack.length).toBe(state.undoStack.length + 1);
  expect(applied.sceneObjects["design-box-table"]).toBeDefined();
  applied.undo();
  expect(useWorkbenchStore.getState().characters).toEqual(state.characters);
  expect(useWorkbenchStore.getState().sceneObjects).toEqual(state.sceneObjects);
  expect(useWorkbenchStore.getState().cameras).toEqual(state.cameras);
  useWorkbenchStore.getState().redo();
  expect(useWorkbenchStore.getState().cameras).toEqual(applied.cameras);
  expect(useWorkbenchStore.getState().sceneObjects).toEqual(applied.sceneObjects);
});

it("incrementally dollies only the camera and preserves target bindings, lens and entities", () => {
  const { proposal } = fixture();
  useWorkbenchStore.getState().applyDesignProposal(proposal);
  const before = useWorkbenchStore.getState(), id = before.selectedCameraId;
  const beforeCamera = before.cameras[id];
  const preview = compileDesignProposal(before, plan([{ kind: "dolly_camera", cameraId: id, towardM: .5 }]));
  expect(preview.characters).toEqual(before.characters);
  expect(preview.sceneObjects).toEqual(before.sceneObjects);
  const after = preview.cameras[id];
  expect(after.focalLengthMm).toBe(beforeCamera.focalLengthMm);
  expect(after.lookAt).toEqual(beforeCamera.lookAt);
  expect(after.subjectTargetIds).toEqual(beforeCamera.subjectTargetIds);
  expect(Math.hypot(...after.transform.position.map((v, i) => v - beforeCamera.transform.position[i]))).toBeCloseTo(.5);
});

it("rejects stale and newly locked proposals without a partial apply or undo entry", () => {
  const { state, ids, proposal } = fixture();
  state.toggleCharacterLocked(ids[1]);
  const locked = useWorkbenchStore.getState();
  expect(() => locked.applyDesignProposal(proposal)).toThrow("场景已变化");
  expect(useWorkbenchStore.getState()).toBe(locked);
  expect(() => compileDesignProposal(locked, { ...proposal, baseRevision: designRevision(locked) })).toThrow("锁定");
});

it("rejects animated scenes, out-of-frame camera targets, overlap and unsupported operations", () => {
  const { state, ids, proposal } = fixture();
  expect(() => compileDesignProposal({ ...state, playheadFrame: 12 }, { ...proposal, baseRevision: designRevision({ ...state, playheadFrame: 12 }) })).toThrow("第 1 帧");
  const overlap = plan([{ kind: "arrange_pair", actorIds: ids, centerM: [0,0,0], separationM: .8, axisDeg: 0 }, { kind: "add_box", entityId: "design-box-table", label: "桌子", positionM: [0,0,0], dimensionsM: [2,2,1] }]);
  expect(() => state.applyDesignProposal(overlap)).toThrow("重叠");
  expect(useWorkbenchStore.getState()).toBe(state);
  const tight = structuredClone(proposal);
  const cameraOp = tight.operations[2];
  if (cameraOp.kind === "frame_camera") { cameraOp.distanceM = .5; cameraOp.focalLengthMm = 200; }
  expect(() => compileDesignProposal(state, tight)).toThrow("画幅");
  expect(() => parseDesignProposal({ ...proposal, operations: [{ kind: "execute_code", code: "bad" }] })).toThrow("不支持");
  expect(() => parseDesignProposal({ ...proposal, operations: [{ kind: "place_entity", entityId: ids[0], positionM: [NaN,0,0], yawDeg: 0 }] })).toThrow("数值");
  expect(() => parseDesignProposal({ ...proposal, operations: [{ kind: "place_entity", entityId: ids[0], positionM: [0,0,0], yawDeg: 0, code: "bad" }] })).toThrow("字段");
});

it("carries actual scene IDs, locks and the latest camera context for follow-up requests", () => {
  const state = useWorkbenchStore.getState();
  const context = JSON.parse(designContext(state));
  expect(context.selectedCameraId).toBe(state.selectedCameraId);
  expect(context.actors[0].characterId).toBe(Object.keys(state.characters)[0]);
  expect(context.cameras).toEqual(state.cameras);
  expect(context.package.packageChecksum).toMatch(/^fnv1a32:/);
});
