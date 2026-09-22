import type { CameraNoiseTrackState } from "../types";

export interface CameraNoiseSample { translationM: [number, number, number]; rotationDeg: [number, number, number] }
export interface BaseCameraSample { positionM: [number, number, number]; rotationDeg: [number, number, number] }

const ZERO: CameraNoiseSample = { translationM: [0, 0, 0], rotationDeg: [0, 0, 0] };
const PROFILE_FACTORS: Record<CameraNoiseTrackState["profile"], [number, number, number]> = { handheld: [1, 1.73, 2.37], breathing: [0.35, 0.5, 1], vehicle: [2.1, 3.7, 5.3], impact: [1, 2, 4] };

function phase(seed: number, axis: number, channel: number): number {
  let value = (seed ^ Math.imul(axis + 1, 0x9e3779b1) ^ Math.imul(channel + 11, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d); value = Math.imul(value ^ (value >>> 15), 0x846ca68b); value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff * Math.PI * 2;
}

export function sampleCameraNoise(track: CameraNoiseTrackState, timeSeconds: number): CameraNoiseSample {
  if (!track.enabled || timeSeconds < track.startSeconds || timeSeconds > track.endSeconds) return structuredClone(ZERO);
  const localTime = timeSeconds - track.startSeconds; const factors = PROFILE_FACTORS[track.profile];
  const wave = (axis: number, channel: number) => Math.sin(Math.PI * 2 * track.frequencyHz * factors[axis] * localTime + phase(track.seed, axis, channel));
  return {
    translationM: track.translationAxisLimitsM.map((limit, axis) => Math.max(-limit, Math.min(limit, wave(axis, 0) * track.translationAmplitudeM))) as [number, number, number],
    rotationDeg: track.rotationAxisLimitsDeg.map((limit, axis) => Math.max(-limit, Math.min(limit, wave(axis, 1) * track.rotationAmplitudeDeg))) as [number, number, number],
  };
}

export function composeCameraNoise(base: BaseCameraSample, track: CameraNoiseTrackState, timeSeconds: number): BaseCameraSample {
  const noise = sampleCameraNoise(track, timeSeconds);
  return { positionM: base.positionM.map((value, axis) => value + noise.translationM[axis]) as [number, number, number], rotationDeg: base.rotationDeg.map((value, axis) => value + noise.rotationDeg[axis]) as [number, number, number] };
}
