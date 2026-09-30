import type { MotionCleanupProcessor, MotionRetargetFrameResult, MotionTrackQuaternion } from "../types";

export interface MotionCleanupOptions {
  maxGapFrames?: number;
  outlierDotThreshold?: number;
  smoothingWindow?: number;
}

const DEFAULTS = { maxGapFrames: 2, outlierDotThreshold: 0.2, smoothingWindow: 3 };
const PROCESSORS: MotionCleanupProcessor[] = [
  { id: "quaternion_continuity", version: "v1", parameters: { enabled: true } },
  { id: "short_gap_interpolation", version: "v1", parameters: { maxGapFrames: DEFAULTS.maxGapFrames } },
  { id: "single_frame_outlier", version: "v1", parameters: { outlierDotThreshold: DEFAULTS.outlierDotThreshold } },
  { id: "torso_smoothing", version: "v1", parameters: { smoothingWindow: DEFAULTS.smoothingWindow } },
];

function dot(a: MotionTrackQuaternion, b: MotionTrackQuaternion): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; }
function normalize(q: MotionTrackQuaternion): MotionTrackQuaternion { const n = Math.hypot(...q); return n < 1e-8 ? [0, 0, 0, 1] : q.map((value) => value / n) as MotionTrackQuaternion; }
function negate(q: MotionTrackQuaternion): MotionTrackQuaternion { return q.map((value) => -value) as MotionTrackQuaternion; }
function nlerp(a: MotionTrackQuaternion, b: MotionTrackQuaternion, t: number): MotionTrackQuaternion { const aligned = dot(a, b) < 0 ? negate(b) : b; return normalize([a[0] + (aligned[0] - a[0]) * t, a[1] + (aligned[1] - a[1]) * t, a[2] + (aligned[2] - a[2]) * t, a[3] + (aligned[3] - a[3]) * t]); }

function cloneFrames(frames: MotionRetargetFrameResult[]): MotionRetargetFrameResult[] { return frames.map((frame) => ({ ...frame, localQuaternions: Object.fromEntries(Object.entries(frame.localQuaternions).map(([id, q]) => [id, [...q] as MotionTrackQuaternion])), warnings: [...frame.warnings] })); }

export function cleanupRetargetFrames(input: MotionRetargetFrameResult[], options: MotionCleanupOptions = {}): { frames: MotionRetargetFrameResult[]; processors: MotionCleanupProcessor[]; warnings: string[] } {
  const config = { ...DEFAULTS, ...options }; const frames = cloneFrames(input); const warnings: string[] = [];
  const processors = PROCESSORS.map((processor) => ({ ...processor, parameters: { ...processor.parameters } }));
  processors.find((item) => item.id === "short_gap_interpolation")!.parameters.maxGapFrames = config.maxGapFrames;
  processors.find((item) => item.id === "single_frame_outlier")!.parameters.outlierDotThreshold = config.outlierDotThreshold;
  processors.find((item) => item.id === "torso_smoothing")!.parameters.smoothingWindow = config.smoothingWindow;

  const jointIds = new Set(frames.flatMap((frame) => Object.keys(frame.localQuaternions)));
  for (const jointId of Array.from(jointIds)) {
    for (let index = 1; index < frames.length; index += 1) {
      const previous = frames[index - 1].localQuaternions[jointId]; const current = frames[index].localQuaternions[jointId];
      if (previous && current && dot(previous, current) < 0) frames[index].localQuaternions[jointId] = negate(current);
    }
    for (let index = 0; index < frames.length; index += 1) {
      if (frames[index].localQuaternions[jointId]) continue;
      let before = index - 1; while (before >= 0 && !frames[before].localQuaternions[jointId]) before -= 1;
      let after = index + 1; while (after < frames.length && !frames[after].localQuaternions[jointId]) after += 1;
      if (before >= 0 && after < frames.length && after - before - 1 <= config.maxGapFrames) {
        const t = (index - before) / (after - before); frames[index].localQuaternions[jointId] = nlerp(frames[before].localQuaternions[jointId], frames[after].localQuaternions[jointId], t);
      }
    }
    for (let index = 1; index + 1 < frames.length; index += 1) {
      const previous = frames[index - 1].localQuaternions[jointId]; const current = frames[index].localQuaternions[jointId]; const next = frames[index + 1].localQuaternions[jointId];
      if (previous && current && next && Math.abs(dot(previous, current)) < config.outlierDotThreshold && Math.abs(dot(previous, next)) > config.outlierDotThreshold) {
        frames[index].localQuaternions[jointId] = nlerp(previous, next, 0.5); frames[index].warnings.push(`${jointId}: single-frame outlier replaced`);
      }
    }
  }
  const torsoIds = Array.from(jointIds).filter((id) => id.startsWith("spine_"));
  if (torsoIds.length > 0 && config.smoothingWindow > 1) {
    for (const jointId of torsoIds) for (let index = 1; index + 1 < frames.length; index += 1) {
      const previous = frames[index - 1].localQuaternions[jointId]; const current = frames[index].localQuaternions[jointId]; const next = frames[index + 1].localQuaternions[jointId];
      if (previous && current && next) frames[index].localQuaternions[jointId] = nlerp(nlerp(previous, current, 0.5), next, 0.5);
    }
  } else warnings.push("torso_smoothing: no spine quaternion tracks available");
  return { frames, processors, warnings };
}
