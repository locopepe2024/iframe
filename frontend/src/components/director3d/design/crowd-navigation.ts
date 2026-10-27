import { solveFlatFoot } from "./foot-contact";
import { navmeshRoute } from "./navmesh-routing";
import type { CharacterAuthoringState } from "../state/workbench-store";
import type { SceneObjectAuthoringState, TimelineTrackState, TimelineKeyframeState } from "../types";
import { evaluateKeyframes } from "../timeline/timeline-evaluation";

type Vec = [number, number, number];
type Rect = {low: Vec; high: Vec};
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function intersects(a: Vec, b: Vec, box: Rect): boolean {
  let enter = 0, leave = 1;
  for (const axis of [0, 1]) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-9) { if (a[axis] <= box.low[axis] || a[axis] >= box.high[axis]) return false; }
    else {
      const first = (box.low[axis] - a[axis]) / d, last = (box.high[axis] - a[axis]) / d;
      enter = Math.max(enter, Math.min(first, last)); leave = Math.min(leave, Math.max(first, last));
    }
  }
  return enter < leave;
}
function route(from: Vec, to: Vec, obstacles: Rect[]): Vec[] {
  for (const point of [from, to]) if (obstacles.some((box) => point[0] > box.low[0] && point[0] < box.high[0] && point[1] > box.low[1] && point[1] < box.high[1])) throw new Error("群演起点或目标被障碍占据。");
  if (!obstacles.some((box) => intersects(from, to, box))) return [from, to];
  const nodes: Vec[] = [from, to, ...obstacles.flatMap((box) => [
    [box.low[0] - .01, box.low[1] - .01, from[2]], [box.low[0] - .01, box.high[1] + .01, from[2]],
    [box.high[0] + .01, box.low[1] - .01, from[2]], [box.high[0] + .01, box.high[1] + .01, from[2]],
  ] as Vec[])];
  if (nodes.length > 250) throw new Error("群演寻路障碍过多，请简化场景。");
  const lengths = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>(); lengths[0] = 0;
  for (let step = 0; step < nodes.length; step++) {
    let at = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (at < 0 || lengths[i] < lengths[at])) at = i;
    if (at < 0 || !Number.isFinite(lengths[at])) break;
    if (at === 1) break;
    visited.add(at);
    for (let next = 0; next < nodes.length; next++) {
      if (visited.has(next) || nodes[next].some((value) => Math.abs(value) > 100) || obstacles.some((box) => intersects(nodes[at], nodes[next], box))) continue;
      const candidate = lengths[at] + distance(nodes[at], nodes[next]);
      if (candidate < lengths[next]) { lengths[next] = candidate; previous[next] = at; }
    }
  }
  if (!Number.isFinite(lengths[1])) throw new Error("群演目标不可达，请调整门口或障碍布局。");
  const result: Vec[] = []; for (let at = 1; at !== -1; at = previous[at]) result.unshift(nodes[at]);
  return result;
}
const positionAt = (track: TimelineTrackState, time: number) => evaluateKeyframes(track.keyframes, time) as Vec;
function conflicts(a: TimelineTrackState, b: TimelineTrackState): boolean {
  const times = Array.from(new Set([0, ...a.keyframes.map((key) => key.timeSeconds), ...b.keyframes.map((key) => key.timeSeconds)])).sort((x, y) => x - y);
  for (let i = 0; i < times.length - 1; i++) {
    const a0 = positionAt(a, times[i]), a1 = positionAt(a, times[i + 1]), b0 = positionAt(b, times[i]), b1 = positionAt(b, times[i + 1]);
    const dx = a0[0] - b0[0], dy = a0[1] - b0[1], vx = a1[0] - b1[0] - dx, vy = a1[1] - b1[1] - dy;
    const t = Math.max(0, Math.min(1, -(dx * vx + dy * vy) / (vx * vx + vy * vy || 1)));
    if (Math.hypot(dx + vx * t, dy + vy * t) < .6 - 1e-6) return true;
  }
  return false;
}
/** Deterministic reference planning; never mutates authored state. */
export function navigateCrowd(tracks: TimelineTrackState[], characters: Record<string, CharacterAuthoringState>, objects: Record<string, SceneObjectAuthoringState>, navigation: "boxes" | "navmesh" = "boxes"): TimelineTrackState[] {
  const moving = tracks.filter((track) => distance(positionAt(track, 0), positionAt(track, 600)) > 1e-6);
  const movingIds = new Set(moving.map((track) => track.target.targetId));
  const stationary = Object.values(characters).filter((actor) => actor.visible && !movingIds.has(actor.characterId));
  const accepted = tracks.filter((track) => !movingIds.has(track.target.targetId));
  const result: TimelineTrackState[] = [];
  for (const track of moving) {
    const from = positionAt(track, 0), to = positionAt(track, 600);
    const obstacles: Rect[] = [];
    for (const object of (navigation === "boxes" ? Object.values(objects) : []).filter((item) => item.visible && item.objectKind !== "empty")) {
      if (object.primitiveKind !== "cube" || object.transform.rotationDeg.some((v) => v !== 0) || object.transform.scale.some((v) => v !== 1)) throw new Error("群演寻路目前只支持轴对齐方盒障碍。");
      const low = object.boundingBoxM.minimum.map((v, axis) => v + object.transform.position[axis]) as Vec;
      const high = object.boundingBoxM.maximum.map((v, axis) => v + object.transform.position[axis]) as Vec;
      if (from[2] >= high[2] || from[2] + 1.8 <= low[2]) continue;
      obstacles.push({low: [low[0] - .31, low[1] - .31, low[2]], high: [high[0] + .31, high[1] + .31, high[2]]});
    }
    for (const actor of stationary) {
      const p = actor.transform.position;
      obstacles.push({low: [p[0] - .61, p[1] - .61, p[2]], high: [p[0] + .61, p[1] + .61, p[2] + 1.8]});
    }
    const points = navigation === "navmesh" ? navmeshRoute(from,to,objects,stationary) : route(from, to, obstacles);
    const requestedStart = track.keyframes.length > 2 ? track.keyframes[1].timeSeconds : 0;
    const duration = track.keyframes.at(-1)!.timeSeconds - requestedStart;
    const length = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
    if (length / duration > 3) throw new Error("群演绕行速度超过 3 米/秒，请延长动作时间。");
    let scheduled: TimelineTrackState | null = null;
    for (let wait = 0; wait <= 8; wait += .25) {
      const start = requestedStart + wait;
      if (start + duration > 600) break;
      let traveled = 0;
      const keyframes: TimelineKeyframeState[] = [{keyframeId: `${track.trackId}-hold`, timeSeconds: 0, value: from, interpolation: "linear"}];
      if (start > 0) keyframes.push({keyframeId: `${track.trackId}-start`, timeSeconds: start, value: from, interpolation: "linear"});
      points.slice(1).forEach((point, i) => { traveled += distance(points[i], point); keyframes.push({keyframeId: `${track.trackId}-route-${i}`, timeSeconds: start + duration * traveled / length, value: point, interpolation: "linear"}); });
      const candidate = {...track, keyframes};
      if (!accepted.some((other) => conflicts(candidate, other))) { scheduled = candidate; break; }
    }
    if (!scheduled) throw new Error("人群拥堵无法在 8 秒等待内安全通过，请调整目标或通行顺序。");
    accepted.push(scheduled); result.push(scheduled);
  }
  return [...tracks.filter((track) => !movingIds.has(track.target.targetId)), ...result];
}

/** Approximate gait, phase tied to actual traveled meters; no contact IK. */
export function crowdGait(track: TimelineTrackState, actor: CharacterAuthoringState): TimelineTrackState[] {
  let traveled = 0;
  const poseKeys: TimelineKeyframeState[] = [], turnKeys: TimelineKeyframeState[] = [];
  const pose = (phase: number, walking: boolean) => {
    const swing = walking ? Math.sin(phase) : 0;
    return {...Object.fromEntries(Object.entries(solveFlatFoot(phase, walking).rotations).map(([id, r]) => [id, [r.x,r.y,r.z]])), upper_arm_l: [(-16 * swing) || 0, 0, 0], upper_arm_r: [16 * swing, 0, 0]};
  };
  for (let i = 0; i < track.keyframes.length - 1; i++) {
    const start = track.keyframes[i], end = track.keyframes[i + 1], from = start.value as Vec, to = end.value as Vec;
    const length = distance(from, to), walking = length > 1e-6;
    const steps = walking ? Math.max(2, Math.ceil(length / .08)) : 1;
    const yaw = walking ? Math.atan2(-(to[0] - from[0]), to[1] - from[1]) * 180 / Math.PI : actor.transform.rotationDeg[2];
    turnKeys.push({keyframeId: `${track.trackId}-yaw-${i}`, timeSeconds: start.timeSeconds, value: {rotation_deg: [0, 0, yaw]}, interpolation: "step"});
    for (let j = 0; j < steps; j++) {
      const amount = j / steps;
      poseKeys.push({keyframeId: `${track.trackId}-gait-${i}-${j}`, timeSeconds: start.timeSeconds + amount * (end.timeSeconds - start.timeSeconds), value: pose((traveled + length * amount) * 2 * Math.PI / 1.2, walking), interpolation: walking ? "linear" : "step"});
    }
    traveled += length;
  }
  poseKeys.push({keyframeId: `${track.trackId}-gait-end`, timeSeconds: track.keyframes.at(-1)!.timeSeconds, value: pose(0, false), interpolation: "linear"});
  return [{...track, trackId: `${track.trackId}-gait`, trackKind: "character_pose", propertyKey: "pose.normalized_values", keyframes: poseKeys},
    {...track, trackId: `${track.trackId}-heading`, propertyKey: "transform.rotation_deg", keyframes: turnKeys}];
}
