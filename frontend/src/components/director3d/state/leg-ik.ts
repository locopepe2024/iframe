import type { MotionIkResult, MotionTrackQuaternion, MotionTrackVector3 } from "../types";

export interface LegIkInput {
  side: "left" | "right";
  hip: MotionTrackVector3 | null;
  knee: MotionTrackVector3 | null;
  ankle: MotionTrackVector3 | null;
  target: MotionTrackVector3 | null;
  poleTarget: MotionTrackVector3 | null;
  originalQuaternions: Record<string, MotionTrackQuaternion>;
  maximumResidualM?: number;
}

type Vec = MotionTrackVector3;
const EPS = 1e-7;
function sub(a: Vec, b: Vec): Vec { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a: Vec, b: Vec): Vec { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(v: Vec, n: number): Vec { return [v[0] * n, v[1] * n, v[2] * n]; }
function dot(a: Vec, b: Vec): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec, b: Vec): Vec { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function length(v: Vec): number { return Math.hypot(v[0], v[1], v[2]); }
function norm(v: Vec): Vec | null { const n = length(v); return n < EPS ? null : scale(v, 1 / n); }
function rotationBetween(a: Vec, b: Vec): MotionTrackQuaternion | null {
  const from = norm(a); const to = norm(b); if (!from || !to) return null;
  const d = Math.max(-1, Math.min(1, dot(from, to)));
  if (d > 1 - EPS) return [0, 0, 0, 1];
  if (d < -1 + EPS) { const axis = norm(cross(from, [1, 0, 0])) ?? norm(cross(from, [0, 1, 0])); return axis ? [axis[0], axis[1], axis[2], 0] : null; }
  const c = cross(from, to); const s = Math.sqrt((1 + d) * 2); return [c[0] / s, c[1] / s, c[2] / s, s / 2];
}

function rejected(input: LegIkInput, reason: MotionIkResult["reason"], residualM = Infinity): MotionIkResult {
  return { status: "rejected", reason, residualM, localQuaternions: { ...input.originalQuaternions } };
}

export function solveLegIk(input: LegIkInput): MotionIkResult {
  const { hip, knee, ankle, target, poleTarget } = input;
  if (!hip || !knee || !ankle || !target || !poleTarget) return rejected(input, "missing_target");
  const upperLength = length(sub(knee, hip)); const lowerLength = length(sub(ankle, knee));
  const toTarget = sub(target, hip); const distance = length(toTarget);
  if (upperLength < EPS || lowerLength < EPS || distance < EPS) return rejected(input, "degenerate_chain");
  if (distance > upperLength + lowerLength || distance < Math.abs(upperLength - lowerLength)) return rejected(input, "target_unreachable", Math.max(distance - upperLength - lowerLength, Math.abs(upperLength - lowerLength) - distance));
  const forward = norm(toTarget)!;
  const poleVector = sub(poleTarget, hip);
  const poleProjection = sub(poleVector, scale(forward, dot(poleVector, forward)));
  const bend = norm(poleProjection);
  if (!bend) return rejected(input, "degenerate_chain");
  const along = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  const solvedKnee = add(add(hip, scale(forward, along)), scale(bend, height));
  const solvedAnkle = target;
  const residualM = Math.abs(length(sub(solvedKnee, hip)) - upperLength) + Math.abs(length(sub(solvedAnkle, solvedKnee)) - lowerLength);
  if (residualM > (input.maximumResidualM ?? 0.01)) return rejected(input, "residual_above_threshold", residualM);
  const upperRotation = rotationBetween(sub(knee, hip), sub(solvedKnee, hip));
  const lowerRotation = rotationBetween(sub(ankle, knee), sub(solvedAnkle, solvedKnee));
  if (!upperRotation || !lowerRotation) return rejected(input, "degenerate_chain", residualM);
  return { status: "accepted", reason: "accepted", residualM, localQuaternions: { ...input.originalQuaternions, [`upper_leg_${input.side === "left" ? "l" : "r"}`]: upperRotation, [`lower_leg_${input.side === "left" ? "l" : "r"}`]: lowerRotation } };
}
