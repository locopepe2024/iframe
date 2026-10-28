import { afterEach, beforeEach, expect, it } from "vitest";
import { useWorkbenchStore } from "../state/workbench-store";
import { compileDesignProposal, designContext, designRevision, parseDesignProposal, type DesignOperation, type DesignProposal } from "./design-proposal";
import { cameraRuntime, evaluatePathPosition } from "../timeline/timeline-evaluation";

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

it("creates an unbound static actor and frames it without adding animation, then preserves notes through apply/export/undo", () => {
  useWorkbenchStore.setState({ rigAdmissionStatus: "passed" });
  const before = useWorkbenchStore.getState();
  const proposal = plan([
    { kind: "add_actor", actorId: "design-extra-keeper", label: "老掌柜", positionM: [8, 0, 0], yawDeg: 90 },
    { kind: "frame_camera", cameraId: before.selectedCameraId, targetIds: ["design-extra-keeper"], azimuthDeg: 0, elevationDeg: 10, distanceM: 6, focalLengthMm: 35 },
  ]);
  proposal.assumptions = ["图像解读（待校正）：店门连着街道", "设计假设：人物深度待校正", "未编排动作：踹倒尚未编排"];
  const preview = compileDesignProposal(before, proposal);
  expect(useWorkbenchStore.getState()).toBe(before);
  expect(preview.dialogueTimeline).toEqual(before.dialogueTimeline);
  expect(preview.cameraPaths).toEqual(before.cameraPaths);
  expect(preview.characters["design-extra-keeper"].label).toBe("老掌柜（白模标记）");
  expect(preview.actorMappings["actor-mapping-design-extra-keeper"].subjectId).toBeNull();
  expect(preview.cameras[before.selectedCameraId].subjectTargetIds).toEqual(["design-extra-keeper"]);
  before.applyDesignProposal(proposal);
  const applied = useWorkbenchStore.getState();
  const bundle = applied.exportDirectorDesignBundle();
  expect(bundle.authoring.designAssumptions).toEqual(proposal.assumptions);
  expect(applied.characters["design-extra-keeper"].transform.position).toEqual([8, 0, 0]);
  expect(applied.undoStack.length).toBe(before.undoStack.length + 1);
  applied.undo();
  expect(useWorkbenchStore.getState().characters).toEqual(before.characters);
  expect(useWorkbenchStore.getState().actorMappings).toEqual(before.actorMappings);
});

it("keeps the existing camera and animation when adding only a static marker", () => {
  useWorkbenchStore.setState({ rigAdmissionStatus: "passed" });
  const state = useWorkbenchStore.getState();
  const animated = compileDesignProposal(state, plan([{ kind: "camera_motion", cameraId: state.selectedCameraId, presetId: "push_in", durationSeconds: 4, easing: "ease_in_out", distanceM: .1 }]));
  useWorkbenchStore.setState({ cameraPaths: animated.cameraPaths, dialogueTimeline: animated.dialogueTimeline });
  const before = useWorkbenchStore.getState();
  const preview = compileDesignProposal(before, plan([{ kind: "add_actor", actorId: "design-extra-bystander", label: "远处百姓", positionM: [8, 8, 0], yawDeg: 0 }]));
  expect(preview.cameras).toEqual(before.cameras);
  expect(preview.cameraPaths).toEqual(before.cameraPaths);
  expect(preview.dialogueTimeline).toEqual(before.dialogueTimeline);
});

it("rejects duplicate static actors, missing rig admission, airborne placement and overlapping blocking", () => {
  const marker = { kind: "add_actor" as const, actorId: "design-extra-new", label: "百姓", positionM: [8, 0, 0] as [number, number, number], yawDeg: 0 };
  useWorkbenchStore.setState({ rigAdmissionStatus: "pending" });
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), plan([marker]))).toThrow(/准入/);
  useWorkbenchStore.setState({ rigAdmissionStatus: "passed" });
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), plan([marker, marker]))).toThrow(/重复/);
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), plan([{ ...marker, positionM: [8, 0, 1] }]))).toThrow(/地面/);
  const positionM = Object.values(useWorkbenchStore.getState().characters)[0].transform.position;
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), plan([{ ...marker, positionM }]))).toThrow(/间距/);
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), plan([
    marker, { kind: "add_box", entityId: "design-box-collision", label: "柜台", positionM: [8, 0, 0], dimensionsM: [2, 1, 1] },
  ]))).toThrow(/重叠/);
  expect(useWorkbenchStore.getState().characters[marker.actorId]).toBeUndefined();
});

it("bounds static cast size without mutating the original scene", () => {
  useWorkbenchStore.setState({ rigAdmissionStatus: "passed" });
  for (let batch = 0; batch < 3; batch++) {
    const operations: DesignOperation[] = Array.from({ length: batch === 2 ? 8 : 15 }, (_, i) => ({
      kind: "add_actor", actorId: `design-extra-cap-${batch}-${i}`, label: "百姓", positionM: [20 + i * 2, batch * 3, 0], yawDeg: 0,
    }));
    useWorkbenchStore.getState().applyDesignProposal(plan(operations));
  }
  const before = useWorkbenchStore.getState();
  expect(Object.values(before.characters).filter(a => a.visible)).toHaveLength(40);
  expect(() => compileDesignProposal(before, plan([{ kind: "add_actor", actorId: "design-extra-over", label: "百姓", positionM: [10, 10, 0], yawDeg: 0 }]))).toThrow(/40/);
  expect(useWorkbenchStore.getState()).toBe(before);
});

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
  state.applyDesignProposal(parseDesignProposal(proposal));
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

it("previews and atomically applies a timed camera path while preserving the authored shot", () => {
  const { state } = fixture();
  const cameraId = state.selectedCameraId;
  const before = state.cameras[cameraId];
  const proposal = plan([{ kind: "camera_motion", cameraId, presetId: "push_in", durationSeconds: 4, easing: "ease_in_out" }]);
  const preview = compileDesignProposal(state, proposal);
  const path = preview.cameraPaths[`path-${cameraId}-motion`];
  expect(path.durationSeconds).toBe(4);
  expect(path.controlPoints[0].positionM).toEqual(before.transform.position);
  expect(preview.cameras[cameraId]).toEqual(before);
  expect(preview.dialogueTimeline.durationSeconds).toBeGreaterThanOrEqual(4);
  expect(preview.dialogueTimeline.tracks.some((track) => track.trackKind === "camera_path_progress" && track.target.targetId === path.pathId)).toBe(true);
  expect(useWorkbenchStore.getState().cameraPaths).toEqual(state.cameraPaths);
  state.applyDesignProposal(parseDesignProposal(proposal));
  const applied = useWorkbenchStore.getState();
  expect(applied.undoStack.length).toBe(state.undoStack.length + 1);
  expect(applied.cameraPaths[path.pathId]).toEqual(path);
  applied.undo();
  expect(useWorkbenchStore.getState().cameraPaths).toEqual(state.cameraPaths);
});

it("moves exactly half a meter over four seconds without changing the authored shot", () => {
  const { state } = fixture();
  const cameraId = state.selectedCameraId;
  // Raw provider JSON must be accepted independently of the TS operation type.
  const proposal = { ...plan([]), operations: [{ kind: "camera_motion", cameraId, presetId: "push_in", durationSeconds: 4, easing: "ease_in_out", distanceM: .5 }] };
  const preview = compileDesignProposal(state, proposal);
  const path = preview.cameraPaths[`path-${cameraId}-motion`];
  const start = state.cameras[cameraId].transform.position;
  const displacement = (time: number) => Math.hypot(...evaluatePathPosition(path, time).map((v, axis) => v - start[axis]));
  expect(displacement(0)).toBeCloseTo(0);
  expect(displacement(2)).toBeCloseTo(.25);
  expect(displacement(4)).toBeCloseTo(.5);
  expect(displacement(8)).toBeCloseTo(.5);
  expect(preview.cameras).toEqual(state.cameras);
  expect(preview.characters).toEqual(state.characters);
  expect(preview.sceneObjects).toEqual(state.sceneObjects);
  state.applyDesignProposal(parseDesignProposal(proposal));
  const applied = useWorkbenchStore.getState();
  expect(applied.undoStack).toHaveLength(state.undoStack.length + 1);
  applied.undo();
  expect(useWorkbenchStore.getState().cameraPaths).toEqual(state.cameraPaths);
  expect(useWorkbenchStore.getState().dialogueTimeline).toEqual(state.dialogueTimeline);
  useWorkbenchStore.getState().redo();
  expect(useWorkbenchStore.getState().cameraPaths).toEqual(preview.cameraPaths);
});

it.each(["pull_out", "lift", "drop", "lateral"] as const)("retains a requested distance for %s", (presetId) => {
  const { state } = fixture();
  const cameraId = state.selectedCameraId;
  const preview = compileDesignProposal(state, plan([{ kind: "camera_motion", cameraId, presetId, durationSeconds: 4, easing: "linear", distanceM: .25 }]));
  const path = preview.cameraPaths[`path-${cameraId}-motion`];
  expect(Math.hypot(...evaluatePathPosition(path, 4).map((v, axis) => v - state.cameras[cameraId].transform.position[axis]))).toBeCloseTo(.25);
});

it("preserves follow bindings while moving toward the world target", () => {
  const { state, ids } = fixture();
  const cameraId = state.selectedCameraId;
  const character = structuredClone(state.characters[ids[0]]);
  character.transform.position = [10, 5, 0];
  useWorkbenchStore.setState({ characters: { ...state.characters, [ids[0]]: character }, cameras: { ...state.cameras, [cameraId]: {
    ...state.cameras[cameraId], transform: { ...state.cameras[cameraId].transform, position: [0, -4, 1] },
    subjectTargetIds: [ids[0]], lookAt: null, follow: { targetType: "character", targetId: ids[0] },
  } } });
  const current = useWorkbenchStore.getState();
  const preview = compileDesignProposal(current, plan([{ kind: "camera_motion", cameraId, presetId: "push_in", durationSeconds: 4, easing: "linear", distanceM: .5 }]));
  const position = evaluatePathPosition(preview.cameraPaths[`path-${cameraId}-motion`], 4);
  const runtime = cameraRuntime(current.cameras[cameraId], current.characters, current.sceneObjects);
  const direction = runtime.targetM.map((v, axis) => v - runtime.positionM[axis]);
  const length = Math.hypot(...direction);
  position.forEach((value, axis) => expect(value).toBeCloseTo(current.cameras[cameraId].transform.position[axis] + .5 * direction[axis] / length));
  expect(preview.cameras).toEqual(current.cameras);
});

it.each([0, -.5, 21, NaN, Infinity, "0.5", true])("rejects invalid travel distance %s without mutating state", (distanceM) => {
  const { state } = fixture();
  expect(() => compileDesignProposal(state, { ...plan([]), operations: [{ kind: "camera_motion", cameraId: state.selectedCameraId, presetId: "push_in", durationSeconds: 4, easing: "linear", distanceM }] })).toThrow("数值");
  expect(useWorkbenchStore.getState()).toBe(state);
});

it("rejects crossing the target, underground motion and arc-distance ambiguity atomically", () => {
  const { state } = fixture();
  for (const [presetId, distanceM, error] of [["push_in", 20, "过近"], ["drop", 20, "地面"], ["orbit", .5, "直线运镜"]] as const) {
    expect(() => state.applyDesignProposal(plan([{ kind: "camera_motion", cameraId: state.selectedCameraId, presetId, durationSeconds: 4, easing: "linear", distanceM }]))).toThrow(error);
    expect(useWorkbenchStore.getState()).toBe(state);
  }
});

it("accepts a provider's null distance as the legacy preset default", () => {
  const { state } = fixture();
  const op = { kind: "camera_motion" as const, cameraId: state.selectedCameraId, presetId: "pull_out" as const, durationSeconds: 4, easing: "linear" as const };
  const original = compileDesignProposal(state, plan([op]));
  expect(compileDesignProposal(state, plan([{ ...op, distanceM: null }])).cameraPaths).toEqual(original.cameraPaths);
});

it("compiles a numbered multi-actor blocking plan with explicit poses", () => {
  const { state, ids } = fixture();
  const third = state.addWhiteModelCharacter();
  useWorkbenchStore.setState({ rigAdmissionStatus: "passed" });
  const admitted = useWorkbenchStore.getState();
  const actorIds = [...ids, Object.keys(admitted.characters).at(-1)!];
  const proposal = plan([{ kind: "arrange_group", members: actorIds.map((actorId, index) => ({ actorId, positionM: [index - 1, 0, 0] as [number, number, number], yawDeg: index === 1 ? 180 : 0, ...(index === 2 ? { presetId: "kneeling.single_knee" as const } : {}) })) }]);
  const preview = compileDesignProposal(admitted, { ...proposal, baseRevision: designRevision(admitted) });
  expect(preview.characters[actorIds[0]].transform.position).toEqual([-1, 0, 0]);
  expect(preview.characters[actorIds[2]].activePresetId).toBe("kneeling.single_knee");
  expect(useWorkbenchStore.getState().characters[actorIds[2]].activePresetId).not.toBe("kneeling.single_knee");
  void third;
});

it("rejects a second natural-language camera path when one already exists", () => {
  const { state } = fixture();
  const cameraId = state.selectedCameraId;
  state.applyCameraPathPreset(cameraId, "push_in", "replace", 2, "ease_in_out");
  const current = useWorkbenchStore.getState();
  const proposal = { ...plan([{ kind: "camera_motion", cameraId, presetId: "pull_out", durationSeconds: 3, easing: "ease_in_out" }]), baseRevision: designRevision(current) };
  expect(() => compileDesignProposal(current, proposal)).toThrow("已有运镜路径");
});

it("accepts omitted group poses serialized as null by the provider schema", () => {
  const { state, ids } = fixture();
  const preview = compileDesignProposal(state, plan([{ kind: "arrange_group", members: ids.map((actorId, i) => ({ actorId, positionM: [i * 2, 0, 0], yawDeg: 0, presetId: null })) }]));
  expect(preview.characters[ids[1]].transform.position).toEqual([2, 0, 0]);
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
it("applies static street layout while preserving existing actor animation paths", () => {
  const state = useWorkbenchStore.getState();
  const actorId = Object.keys(state.characters)[0];
  const actorPaths = {existing: {pathId: "existing", targetType: "character" as const, targetId: actorId, durationSeconds: 6, easing: "linear" as const, controlPoints: [{controlPointId: "a", positionM: [0,0,0] as [number,number,number], handleInM: [0,0,0] as [number,number,number], handleOutM: [0,0,0] as [number,number,number], order: 0}, {controlPointId: "b", positionM: [1,0,0] as [number,number,number], handleInM: [1,0,0] as [number,number,number], handleOutM: [1,0,0] as [number,number,number], order: 1}], revision: 1, locked: false, visible: true}};
  const withPath = {...state, actorPaths};
  const proposal = {...plan([{kind: "street_layout", layoutId: "design-street-side-door", centerM: [0,0,0], widthM: 8, lengthM: 30, buildings: [{id: "shop", label: "粮铺", centerM: [6.5,0,0], dimensionsM: [5,6,4], doorWidthM: 2, frontSide: "negative_x"}], trees: []}]), baseRevision: designRevision(withPath)};
  const preview = compileDesignProposal(withPath, proposal);
  expect(preview.sceneObjects).toHaveProperty("design-street-side-door-shop-pier--1");
  expect(preview.characters[actorId]).toEqual(state.characters[actorId]);
  expect(withPath.actorPaths).toEqual(actorPaths);
});
