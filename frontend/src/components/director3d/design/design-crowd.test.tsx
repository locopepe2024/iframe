import { afterEach, beforeEach, expect, it } from "vitest";
import { useWorkbenchStore } from "../state/workbench-store";
import { compileDesignProposal, designRevision, type DesignOperation, type CrowdMember } from "./design-proposal";
import { currentDirectorShotPackage } from "../reference/current-shot-package";

const initial = useWorkbenchStore.getState();
beforeEach(() => {
  useWorkbenchStore.setState(initial, true);
  useWorkbenchStore.setState({crowdGroups: {}, rigAdmissionStatus: "passed", actorPaths: {}, cameraPaths: {}, dialogueTimeline: {...initial.dialogueTimeline, tracks: [], activeCameraTrackId: null}, undoStack: [], redoStack: []});
});
afterEach(() => useWorkbenchStore.setState(initial, true));
const member = (id: string, x: number, y: number, startSeconds = 0): CrowdMember => ({actorId: `design-extra-${id}`, positionM: [x, y, 0], destinationM: [x + 2, y, 0], yawDeg: -90, startSeconds, durationSeconds: 4});
const group = (id: string, members: CrowdMember[], behavior: "avoid" | "observe" | "pass" = "avoid"): DesignOperation => ({kind: "crowd_motion", groupId: `design-crowd-${id}`, label: id, behavior, members});
const proposal = (operations: DesignOperation[]) => ({schemaVersion: "iframe.director3d.design-proposal.v1" as const, baseRevision: designRevision(useWorkbenchStore.getState()), summary: "粮铺群演参考", assumptions: ["近中远景人数与反应时间为设计假设"], clarification: null, operations});
function fixture(): DesignOperation[] {
  return [group("near", [member("near", -5, 1)]), group("middle", [member("middle", -5, 4, 2)]), group("far", [member("far", -5, 8)], "pass"), group("observe", [{...member("observe", 5, 4), destinationM: [5, 4, 0]}], "observe"),
    {kind: "add_camera", cameraId: "design-camera-middle", label: "中景观察", targetIds: ["design-extra-middle", "design-extra-observe"], azimuthDeg: 0, elevationDeg: 10, distanceM: 15, focalLengthMm: 35},
    {kind: "camera_cut", cameraId: "camera-main", timeSeconds: 0}, {kind: "camera_cut", cameraId: "design-camera-middle", timeSeconds: 3}];
}
it("previews grain-shop groups without changing authored state, then evaluates delayed movement and exact cuts", () => {
  const before = useWorkbenchStore.getState();
  const preview = compileDesignProposal(before, proposal(fixture()));
  expect(useWorkbenchStore.getState()).toBe(before);
  expect(Object.keys(preview.crowdGroups)).toHaveLength(4);
  before.applyDesignProposal(proposal(fixture()));
  const at = (seconds: number) => currentDirectorShotPackage(useWorkbenchStore.getState(), seconds * initial.dialogueTimeline.fps + 1);
  const x = (seconds: number, id: string) => at(seconds).characters.find((actor) => actor.characterId === `design-extra-${id}`)!.transform.position[0];
  expect(x(1, "near")).toBeCloseTo(-4.5);
  expect(x(1, "middle")).toBe(-5);
  expect(x(2, "middle")).toBe(-5);
  expect(x(4, "middle")).toBe(-4);
  expect(x(1, "far")).toBeCloseTo(-4.5);
  expect(x(6, "observe")).toBe(5);
  expect(at(2).activeCameraId).toBe("camera-main");
  expect(at(3).activeCameraId).toBe("design-camera-middle");
  expect(preview.actorMappings[preview.characters["design-extra-near"].actorMappingId]).toBeDefined();
});
it("applies atomically, round-trips groups/tracks through bundles, and restores with undo/redo", () => {
  const before = useWorkbenchStore.getState(); before.applyDesignProposal(proposal(fixture()));
  const applied = useWorkbenchStore.getState();
  const bundle = applied.exportDirectorDesignBundle();
  expect(applied.undoStack).toHaveLength(1);
  applied.undo(); expect(useWorkbenchStore.getState().crowdGroups).toEqual({}); expect(useWorkbenchStore.getState().characters).toEqual(before.characters);
  useWorkbenchStore.getState().redo(); expect(useWorkbenchStore.getState().crowdGroups).toEqual(applied.crowdGroups);
  expect(useWorkbenchStore.getState().importDirectorDesignBundle(JSON.parse(JSON.stringify(bundle)))).toEqual({ok: true});
  expect(useWorkbenchStore.getState().dialogueTimeline).toEqual(applied.dialogueTimeline);
});
it("rejects invalid groups, observers moving, duplicate membership/cuts, hidden actors and unknown cuts without partial mutation", () => {
  const before = useWorkbenchStore.getState();
  for (const operations of [
    [group("a", [member("a", -5, 2), member("a", -5, 4)])],
    [group("a", [member("a", -5, 2)], "observe")],
    [group("a", [member("a", -5, 2)]), group("b", [member("a", -5, 2)])],
    [{kind: "camera_cut", cameraId: "missing", timeSeconds: 0}],
    [{kind: "camera_cut", cameraId: "camera-main", timeSeconds: 0}, {kind: "camera_cut", cameraId: "camera-main", timeSeconds: 0}],
    [group("a", [{...member("a", -5, 2), startSeconds: 599}])],
  ] as DesignOperation[][]) {
    expect(() => before.applyDesignProposal(proposal(operations))).toThrow();
    expect(useWorkbenchStore.getState()).toBe(before);
  }
});
it("rejects crossing actors and swept paths through boxes, including collisions between key times", () => {
  const before = useWorkbenchStore.getState();
  const first = {...member("a", -5, 2), destinationM: [5, 2, 0] as [number, number, number]};
  const second = {...member("b", 5, 2), destinationM: [-5, 2, 0] as [number, number, number]};
  expect(() => compileDesignProposal(before, proposal([group("cross", [first, second])]))).toThrow("路径");
  expect(() => compileDesignProposal(before, proposal([{kind: "add_box", entityId: "design-box-counter", label: "柜台", positionM: [0, 2, 0], dimensionsM: [1, 1, 1]}, group("near", [first])]))).toThrow("道具");
});

it("rejects hidden or locked existing actors and conflicting edits to a crowd member", () => {
  const id = Object.keys(initial.characters)[0];
  for (const patch of [{visible: false}, {locked: true}]) {
    useWorkbenchStore.setState({characters: {...initial.characters, [id]: {...initial.characters[id], ...patch}}});
    expect(() => compileDesignProposal(useWorkbenchStore.getState(), proposal([group("existing", [{...member("a", -5, 2), actorId: id}])]))).toThrow();
  }
  useWorkbenchStore.setState({characters: initial.characters});
  expect(() => compileDesignProposal(useWorkbenchStore.getState(), proposal([group("near", [member("a", -5, 2)]), {kind: "place_entity", entityId: "design-extra-a", positionM: [3, 3, 0], yawDeg: 0}]))).toThrow("冲突");
});
