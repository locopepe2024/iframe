import { describe, expect, it } from "vitest";

import { cleanupRetargetFrames } from "../components/director3d/state/motion-cleanup";
import type { MotionRetargetFrameResult } from "../components/director3d/types";

const q = (x: number): [number, number, number, number] => [x, 0, 0, Math.sqrt(Math.max(0, 1 - x * x))];
const frame = (frameNumber: number, quaternion?: [number, number, number, number]): MotionRetargetFrameResult => ({ frame: frameNumber, rootPosition: null, pelvisQuaternion: null, localQuaternions: quaternion ? { upper_leg_l: quaternion } : {}, warnings: [] });

describe("motion cleanup", () => {
  it("interpolates a short quaternion gap and records processors", () => {
    const result = cleanupRetargetFrames([frame(1, q(0)), frame(2), frame(3, q(0.2))]);
    expect(result.frames[1].localQuaternions.upper_leg_l).toHaveLength(4);
    expect(result.processors.map((processor) => processor.id)).toContain("short_gap_interpolation");
  });
  it("keeps source frames immutable", () => {
    const source = [frame(1, q(0)), frame(2)];
    cleanupRetargetFrames(source);
    expect(source[1].localQuaternions).toEqual({});
  });
});
