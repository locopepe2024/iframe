import { describe, expect, it } from "vitest";

import { evaluateFootContacts } from "../components/director3d/state/foot-contact";
import type { MotionTrackFrame } from "../components/director3d/types";

function makeFrame(frame: number, candidate = true, x = 0): MotionTrackFrame {
  return { frame, sourceFrame: frame, sourceTimestampSeconds: (frame - 1) / 24, selectionStatus: "tracked", rootPosition: null, semanticJoints: {}, jointConfidence: {}, footTargets: { left: { ankle: [x, 0, 0], heel: null, toe: null }, right: { ankle: [x, 0, 0], heel: null, toe: null } }, footContactCandidates: { left: { candidate, confidence: 0.9 }, right: { candidate, confidence: 0.9 } } };
}

describe("foot contact admission", () => {
  it("requires calibration and three continuous candidate frames", () => {
    const frames = [makeFrame(1), makeFrame(2), makeFrame(3)];
    expect(evaluateFootContacts(frames).find((item) => item.side === "left" && item.frame === 2)?.reason).toBe("ground_not_calibrated");
    expect(evaluateFootContacts(frames, { groundHeightM: 0 }).find((item) => item.side === "left" && item.frame === 2)?.status).toBe("accepted");
  });
  it("rejects excessive movement", () => {
    const result = evaluateFootContacts([makeFrame(1, true, 0), makeFrame(2, true, 1), makeFrame(3, true, 2)], { groundHeightM: 0 });
    expect(result.find((item) => item.side === "left" && item.frame === 2)?.reason).toBe("velocity_above_threshold");
  });
});
