import { afterEach, beforeEach, expect, it } from "vitest";
import { useWorkbenchStore } from "../state/workbench-store";
import { compileDesignProposal, designContext, designRevision, parseDesignProposal, type DesignOperation } from "./design-proposal";
import { currentDirectorShotPackage } from "../reference/current-shot-package";
import { DESIGN_POSES, SEATED_FIT } from "./design-poses";

const initial = useWorkbenchStore.getState();
beforeEach(() => {
  useWorkbenchStore.setState(initial, true);
  if (Object.keys(initial.characters).length < 2) initial.addWhiteModelCharacter();
  const s = useWorkbenchStore.getState();
  useWorkbenchStore.setState({ rigAdmissionStatus: "passed", sceneObjects: {}, actorPaths: {}, cameraPaths: {}, playheadFrame: 1,
    characters: Object.fromEntries(Object.entries(s.characters).slice(0, 2).map(([id, actor], i) => [id, { ...structuredClone(actor), transform: { ...actor.transform, position: [i * 2 - 1, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false, calibratedPlacement: null, proxyAssetId: null }])),
    dialogueTimeline: { ...s.dialogueTimeline, tracks: [], activeCameraTrackId: null }, undoStack: [], redoStack: [] });
});
afterEach(() => useWorkbenchStore.setState(initial, true));
const proposal = (operations: DesignOperation[]) => ({ schemaVersion: "iframe.director3d.design-proposal.v1" as const, baseRevision: designRevision(useWorkbenchStore.getState()), summary: "双人坐椅子并保留当前机位", assumptions: ["使用程序化椅子参考"], clarification: null, operations });
const seats = (): DesignOperation[] => Object.keys(useWorkbenchStore.getState().characters).map((actorId, i) => ({ kind: "seat_actor", actorId, chairId: `design-chair-${i}` }));

it("previews two seated actors and 12 editable chair parts, preserving cameras, XY/yaw and the authored scene", () => {
  const before = useWorkbenchStore.getState();
  const preview = compileDesignProposal(before, proposal(seats()));
  expect(useWorkbenchStore.getState()).toBe(before);
  expect(preview.cameras).toEqual(before.cameras);
  expect(Object.keys(preview.sceneObjects)).toHaveLength(12);
  for (const actor of Object.values(preview.characters)) {
    expect(actor.activePresetId).toBe("seated.sit");
    expect(actor.transform).toEqual(before.characters[actor.characterId].transform);
    expect(actor.poseRootOffsetM[2]).toBeCloseTo(-.42 + SEATED_FIT.groundLiftM);
    expect(actor.jointRotations.upper_leg_l.x).toBe(-78);
  }
  expect(Object.values(preview.sceneObjects).every((o) => o.label.includes("程序化占位"))).toBe(true);
});

it("atomically applies and undo/redo restores pose, chairs, cameras and checksum", () => {
  const before = useWorkbenchStore.getState();
  const oldPackage = currentDirectorShotPackage(before);
  before.applyDesignProposal(proposal(seats()));
  const applied = useWorkbenchStore.getState();
  expect(applied.undoStack).toHaveLength(1);
  expect(currentDirectorShotPackage(applied).packageChecksum).not.toBe(oldPackage.packageChecksum);
  applied.undo();
  expect(useWorkbenchStore.getState().characters).toEqual(before.characters);
  expect(useWorkbenchStore.getState().sceneObjects).toEqual(before.sceneObjects);
  expect(currentDirectorShotPackage(useWorkbenchStore.getState()).packageChecksum).toBe(oldPackage.packageChecksum);
  useWorkbenchStore.getState().redo();
  expect(useWorkbenchStore.getState().characters).toEqual(applied.characters);
  expect(useWorkbenchStore.getState().sceneObjects).toEqual(applied.sceneObjects);
  expect(useWorkbenchStore.getState().cameras).toEqual(before.cameras);
});

it("includes root offsets in shot checksums even when joints and transforms are identical", () => {
  const before = useWorkbenchStore.getState(), id = Object.keys(before.characters)[0];
  const old = currentDirectorShotPackage(before);
  useWorkbenchStore.setState({ characters: { ...before.characters, [id]: { ...before.characters[id], poseRootOffsetM: [0, 0, .1] } } });
  expect(currentDirectorShotPackage(useWorkbenchStore.getState()).packageChecksum).not.toBe(old.packageChecksum);
});

it("rejects hidden/locked/calibrated/custom/scaled/tilted actors and unadmitted rigs without partial changes", () => {
  const before = useWorkbenchStore.getState(), id = Object.keys(before.characters)[0];
  const actor = before.characters[id];
  for (const changes of [{ visible: false }, { locked: true }, { proxyAssetId: "other-rig" }, { transform: { ...actor.transform, scale: [2, 2, 2] as [number, number, number] } }, { transform: { ...actor.transform, rotationDeg: [20, 0, 0] as [number, number, number] } }]) {
    useWorkbenchStore.setState({ characters: { ...before.characters, [id]: { ...actor, ...changes } } });
    const current = useWorkbenchStore.getState();
    expect(() => current.applyDesignProposal(proposal(seats()))).toThrow();
    expect(useWorkbenchStore.getState()).toBe(current);
  }
  useWorkbenchStore.setState({ characters: before.characters, rigAdmissionStatus: "pending" });
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), proposal(seats()))).toThrow("骨架");
});

it("rejects duplicate seating, conflicting chair IDs, stale proposals and overlapping furniture", () => {
  const state = useWorkbenchStore.getState(), operations = seats();
  expect(() => compileDesignProposal(state, proposal([operations[0], operations[0]]))).toThrow("重复");
  state.applyDesignProposal(proposal(operations));
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), proposal(operations))).toThrow("重复");
  useWorkbenchStore.getState().undo();
  const stale = proposal(seats());
  useWorkbenchStore.getState().toggleCharacterLocked(Object.keys(state.characters)[0]);
  expect(() => useWorkbenchStore.getState().applyDesignProposal(stale)).toThrow("场景已变化");
  useWorkbenchStore.getState().toggleCharacterLocked(Object.keys(state.characters)[0]);
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), proposal([
    { kind: "add_box", entityId: "design-box-obstacle", label: "障碍", positionM: [-1, 0, 0], dimensionsM: [.2, .2, 1] }, ...seats(),
  ]))).toThrow("重叠");
});

it("fits a yaw-rotated chair and rejects proximity to the other actor", () => {
  const state = useWorkbenchStore.getState(), id = Object.keys(state.characters)[0];
  const actor = state.characters[id];
  useWorkbenchStore.setState({ characters: { ...state.characters, [id]: { ...actor, transform: { ...actor.transform, rotationDeg: [0, 0, 90] } } } });
  const preview = compileDesignProposal(useWorkbenchStore.getState(), proposal([seats()[0]]));
  expect(preview.sceneObjects["design-chair-0-back"].transform.position[0]).toBeCloseTo(-1.23);
  expect(preview.sceneObjects["design-chair-0-back"].transform.rotationDeg).toEqual([0, 0, 90]);
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), proposal([
    { kind: "place_entity", entityId: Object.keys(state.characters)[1], positionM: [-1, -.2, 0], yawDeg: 0 }, seats()[0],
  ]))).toThrow("间距");
});

it("exposes only supported pose IDs and rejects unknown poses and extra model fields", () => {
  const state = useWorkbenchStore.getState(), id = Object.keys(state.characters)[0];
  expect(JSON.parse(designContext(state)).posePresets).toEqual(DESIGN_POSES);
  for (const presetId of DESIGN_POSES) {
    const preview = compileDesignProposal(state, proposal([{ kind: "set_pose", actorId: id, presetId }]));
    expect(preview.characters[id].activePresetId).toBe(presetId);
    expect(preview.cameras).toEqual(state.cameras);
  }
  expect(() => parseDesignProposal(proposal([{ kind: "set_pose", actorId: id, presetId: "arbitrary" } as never]))).toThrow("预设");
  expect(() => parseDesignProposal(proposal([{ ...seats()[0], code: "bad" } as never]))).toThrow("字段");
});
