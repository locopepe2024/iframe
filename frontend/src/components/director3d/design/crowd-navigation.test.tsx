import { expect, it } from "vitest";
import { navigateCrowd, crowdGait } from "./crowd-navigation";
import { useWorkbenchStore } from "../state/workbench-store";
import { evaluateKeyframes } from "../timeline/timeline-evaluation";
import type { TimelineTrackState, SceneObjectAuthoringState } from "../types";
const actor = Object.values(useWorkbenchStore.getState().characters)[0];
function track(id: string, from: number[], to: number[], start = 0, duration = 4): TimelineTrackState {
  return {trackId: id, trackKind: "character_transform", target: {targetType: "character", targetId: id}, propertyKey: "transform.position_m", keyframes: [
    {keyframeId: `${id}-0`, timeSeconds: 0, value: from, interpolation: "linear"},
    ...(start ? [{keyframeId: `${id}-1`, timeSeconds: start, value: from, interpolation: "linear" as const}] : []),
    {keyframeId: `${id}-end`, timeSeconds: start + duration, value: to, interpolation: "linear"}]};
}
const actors = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, {...actor, characterId: id}]));
function counter(): SceneObjectAuthoringState {
  const s = useWorkbenchStore.getState(); s.addPrimitive("cube");
  const result = {...Object.values(useWorkbenchStore.getState().sceneObjects).at(-1)!}; useWorkbenchStore.setState(s, true);
  return {...result, transform: {...result.transform, position: [0, 0, 0]}, boundingBoxM: {minimum: [-.5, -.5, 0], maximum: [.5, .5, 1]}};
}
it("routes around a counter with clearance and preserved arrival duration", () => {
  const [routed] = navigateCrowd([track("a", [-3, 0, 0], [3, 0, 0])], actors(["a"]), {counter: counter()});
  expect(routed.keyframes.length).toBeGreaterThan(2);
  expect(routed.keyframes.at(-1)!.timeSeconds).toBe(4);
  for (let time = 0; time <= 4; time += .02) {
    const p = evaluateKeyframes(routed.keyframes, time) as number[];
    expect(Math.abs(p[0]) < .8 && Math.abs(p[1]) < .8).toBe(false);
  }
});
it("delays crossing traffic and preserves continuous clearance while waiting and after arrival", () => {
  const routed = navigateCrowd([track("a", [-2, 0, 0], [2, 0, 0]), track("b", [0, -2, 0], [0, 2, 0])], actors(["a", "b"]), {});
  expect(routed[1].keyframes.at(-1)!.timeSeconds).toBeGreaterThan(4);
  for (let t = 0; t <= 12; t += .01) {
    const a = evaluateKeyframes(routed[0].keyframes, t) as number[], b = evaluateKeyframes(routed[1].keyframes, t) as number[];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(.599999);
  }
});
it("rejects occupied destinations, excessive speed and unsupported geometry", () => {
  expect(() => navigateCrowd([track("a", [-3, 0, 0], [0, 0, 0])], actors(["a"]), {counter: counter()})).toThrow("占据");
  expect(() => navigateCrowd([track("a", [-3, 0, 0], [3, 0, 0], 0, .2)], actors(["a"]), {})).toThrow("速度");
  const box = counter(); box.transform.rotationDeg = [0, 0, 45];
  expect(() => navigateCrowd([track("a", [-3, 0, 0], [3, 0, 0])], actors(["a"]), {box})).toThrow("轴对齐");
});
it("ties gait to distance rather than elapsed time, holds neutral when waiting/stopped, and faces travel", () => {
  const slow = crowdGait(track("a", [0, 0, 0], [2.4, 0, 0], 2, 4), actor);
  const fast = crowdGait(track("a", [0, 0, 0], [2.4, 0, 0], 0, 2), actor);
  const pose = (tracks: TimelineTrackState[], time: number) => evaluateKeyframes(tracks[0].keyframes, time) as Record<string, number[]>;
  expect(pose(slow, 1).upper_leg_l[0]).toBeCloseTo(0,5);
  expect(pose(slow, 6).upper_leg_l[0]).toBeCloseTo(0,5);
  expect(pose(slow, 2.5).upper_leg_l[0]).toBeCloseTo(pose(fast, .25).upper_leg_l[0]);
  expect(Math.abs(pose(slow, 2.5).upper_leg_l[0])).toBeGreaterThan(5);
  expect(evaluateKeyframes(slow[1].keyframes, 3)).toEqual({rotation_deg: [0, 0, -90]});
});
it("routes around a stationary observer and preserves observation holds", () => {
  const a = {...actor, characterId: "observer", transform: {...actor.transform, position: [0, 0, 0] as [number, number, number]}};
  const observer = track("observer", [0, 0, 0], [0, 0, 0]);
  const routed = navigateCrowd([track("a", [-2, 0, 0], [2, 0, 0]), observer], {...actors(["a"]), observer: a}, {});
  expect(routed.find((item) => item.target.targetId === "a")!.keyframes.length).toBeGreaterThan(2);
  expect(routed.find((item) => item.target.targetId === "observer")).toEqual(observer);
});
