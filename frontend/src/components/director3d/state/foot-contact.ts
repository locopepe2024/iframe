import type { MotionFootContactEvaluation, MotionTrackFrame, MotionTrackVector3 } from "../types";

export interface FootContactOptions {
  minimumConfidence: number;
  minimumContinuousFrames: number;
  maximumSpeedMps: number;
  maximumHeightDeltaM: number;
  groundHeightM: number | null;
}

const DEFAULTS: FootContactOptions = { minimumConfidence: 0.7, minimumContinuousFrames: 3, maximumSpeedMps: 0.15, maximumHeightDeltaM: 0.08, groundHeightM: null };

function distance(a: MotionTrackVector3, b: MotionTrackVector3): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function target(frame: MotionTrackFrame, side: "left" | "right"): MotionTrackVector3 | null { return frame.footTargets[side].ankle ?? frame.footTargets[side].heel ?? frame.footTargets[side].toe; }

export function evaluateFootContacts(frames: MotionTrackFrame[], options: Partial<FootContactOptions> = {}): MotionFootContactEvaluation[] {
  const config = { ...DEFAULTS, ...options };
  const result: MotionFootContactEvaluation[] = [];
  for (const side of ["left", "right"] as const) {
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index]; const candidate = frame.footContactCandidates[side]; const point = target(frame, side);
      let status: MotionFootContactEvaluation["status"] = "rejected"; let reason: MotionFootContactEvaluation["reason"] = "accepted";
      if (!point) reason = "missing_target";
      else if (config.groundHeightM === null) reason = "ground_not_calibrated";
      else if (candidate.confidence < config.minimumConfidence) reason = "insufficient_confidence";
      else {
        let continuity = 1;
        for (let cursor = index - 1; cursor >= 0 && frames[cursor].footContactCandidates[side].candidate; cursor -= 1) continuity += 1;
        for (let cursor = index + 1; cursor < frames.length && frames[cursor].footContactCandidates[side].candidate; cursor += 1) continuity += 1;
        if (!candidate.candidate || continuity < config.minimumContinuousFrames) reason = "insufficient_continuity";
        else {
          const previous = index > 0 ? target(frames[index - 1], side) : null;
          const next = index + 1 < frames.length ? target(frames[index + 1], side) : null;
          const currentTime = frame.sourceTimestampSeconds;
          const previousTime = index > 0 ? frames[index - 1].sourceTimestampSeconds : null;
          const fps = currentTime !== null && previous && previousTime !== null
            ? Math.max(1, 1 / Math.max(1e-6, currentTime - previousTime)) : 24;
          const speed = previous ? distance(point, previous) * fps : next ? distance(point, next) * fps : 0;
          const heightDelta = Math.abs(point[2] - config.groundHeightM);
          if (speed > config.maximumSpeedMps) reason = "velocity_above_threshold";
          else if (heightDelta > config.maximumHeightDeltaM) reason = "height_above_threshold";
          else { status = "accepted"; }
        }
      }
      result.push({ frame: frame.frame, side, status, confidence: candidate.confidence, reason });
    }
  }
  return result.sort((a, b) => a.frame - b.frame || a.side.localeCompare(b.side));
}
