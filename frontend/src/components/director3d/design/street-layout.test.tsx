import { afterEach, beforeEach, expect, it } from "vitest";
import { compileStreetLayout, type StreetLayout } from "./street-layout";
import { compileDesignProposal, designRevision, type DesignOperation } from "./design-proposal";
import { navigateCrowd } from "./crowd-navigation";
import { useWorkbenchStore } from "../state/workbench-store";
import { evaluateKeyframes } from "../timeline/timeline-evaluation";
import type { TimelineTrackState } from "../types";
const initial = useWorkbenchStore.getState();
beforeEach(() => {useWorkbenchStore.setState(initial, true); useWorkbenchStore.setState({actorPaths: {}, cameraPaths: {}, dialogueTimeline: {...initial.dialogueTimeline, tracks: []}});});
afterEach(() => useWorkbenchStore.setState(initial, true));
const street = (): StreetLayout => ({kind: "street_layout", layoutId: "design-street-grain", centerM: [0,0,0], widthM: 6, lengthM: 12,
  buildings: [{id: "shop", label: "粮铺", centerM: [0,9,0], dimensionsM: [6,6,4], doorWidthM: 2, frontSide: "negative_y"}],
  trees: [{id: "tree", positionM: [-2,-4,0], heightM: 5, trunkWidthM: .6}]});
const plan = (operations: DesignOperation[]) => ({schemaVersion: "iframe.director3d.design-proposal.v1" as const, baseRevision: designRevision(useWorkbenchStore.getState()), summary: "粮铺长街", assumptions: ["长街宽六米，门宽两米"], clarification: null, operations});
it("builds an open doorway above a connected ground-level road with stable editable IDs", () => {
  const objects = compileStreetLayout(street(),0);
  expect(objects).toHaveLength(10);
  expect(new Set(objects.map((o) => o.sceneObjectId)).size).toBe(objects.length);
  const road = objects.find((o) => o.sceneObjectId.endsWith("-road"))!;
  expect(road.transform.position[2] + road.boundingBoxM.maximum[2]).toBe(0);
  const piers = objects.filter((o) => o.sceneObjectId.includes("-pier-"));
  expect(piers.map((o) => o.dimensionsM[0])).toEqual([2,2]);
  expect(objects.find((o) => o.sceneObjectId.endsWith("-lintel"))!.transform.position[2]).toBe(2.2);
});
it("routes a person through the actual door opening into the shop", () => {
  const objects = Object.fromEntries(compileStreetLayout(street(),0).map((o) => [o.sceneObjectId,o]));
  const actor = Object.values(initial.characters)[0];
  const track: TimelineTrackState = {trackId: "entry", trackKind: "character_transform", target: {targetType: "character", targetId: actor.characterId}, propertyKey: "transform.position_m",
    keyframes: [{keyframeId: "a", timeSeconds: 0, value: [0,3,0], interpolation: "linear"}, {keyframeId: "b", timeSeconds: 4, value: [0,9,0], interpolation: "linear"}]};
  const [routed] = navigateCrowd([track], {[actor.characterId]: actor}, objects);
  expect(evaluateKeyframes(routed.keyframes,2)).toEqual([0,6,0]);
  expect(evaluateKeyframes(routed.keyframes,4)).toEqual([0,9,0]);
});
it("previews without mutation, applies once and preserves layout in bundles and undo/redo", () => {
  const before = useWorkbenchStore.getState(), p = plan([street()]);
  const preview = compileDesignProposal(before,p);
  expect(useWorkbenchStore.getState()).toBe(before);
  before.applyDesignProposal(p);
  const applied = useWorkbenchStore.getState(); expect(applied.sceneObjects).toEqual(preview.sceneObjects);
  const bundle = applied.exportDirectorDesignBundle();
  applied.undo(); expect(useWorkbenchStore.getState().sceneObjects).toEqual(before.sceneObjects);
  useWorkbenchStore.getState().redo(); expect(useWorkbenchStore.getState().sceneObjects).toEqual(preview.sceneObjects);
  expect(useWorkbenchStore.getState().importDirectorDesignBundle(JSON.parse(JSON.stringify(bundle)))).toEqual({ok:true});
});
it("rejects overlapping footprints, oversized doors, duplicate IDs and below-ground layouts atomically", () => {
  const before = useWorkbenchStore.getState();
  const overlapping = street(); overlapping.buildings[0].centerM = [0,0,0];
  const door = street(); door.buildings[0].doorWidthM = 6;
  const duplicate = street(); duplicate.trees.push(duplicate.trees[0]);
  const below = street(); below.centerM[2] = -1;
  for (const value of [overlapping,door,duplicate,below]) {
    expect(() => before.applyDesignProposal(plan([value]))).toThrow(); expect(useWorkbenchStore.getState()).toBe(before);
  }
});
it("supports a side-facing storefront door in the middle of the Y-axis road", () => {
  const side: StreetLayout = {...street(), buildings: [{id: "shop-side", label: "街边粮铺", centerM: [7,0,0], dimensionsM: [6,6,4], doorWidthM: 2, frontSide: "negative_x"}]};
  const objects = compileStreetLayout(side, 0);
  expect(objects).toHaveLength(10);
  const piers = objects.filter((o) => o.sceneObjectId.includes("-pier-"));
  expect(piers.map((o) => o.dimensionsM[1])).toEqual([2,2]);
  expect(objects.find((o) => o.sceneObjectId.endsWith("-lintel"))!.dimensionsM).toEqual([.15,2,expect.closeTo(1.8)]);
  const actor = Object.values(initial.characters)[0];
  const track: TimelineTrackState = {trackId: "side-entry", trackKind: "character_transform", target: {targetType: "character", targetId: actor.characterId}, propertyKey: "transform.position_m",
    keyframes: [{keyframeId: "a", timeSeconds: 0, value: [3,0,0], interpolation: "linear"}, {keyframeId: "b", timeSeconds: 4, value: [7,0,0], interpolation: "linear"}]};
  const routed = navigateCrowd([track], {[actor.characterId]: actor}, Object.fromEntries(objects.map((o) => [o.sceneObjectId,o])))[0];
  expect(evaluateKeyframes(routed.keyframes, 4)).toEqual([7,0,0]);
});
