import { describe, expect, it } from "vitest";

import { solveLegIk } from "../components/director3d/state/leg-ik";

const original = { upper_leg_l: [0, 0, 0, 1] as [number, number, number, number], lower_leg_l: [0, 0, 0, 1] as [number, number, number, number] };
const base = { side: "left" as const, hip: [0, 2, 0] as [number, number, number], knee: [0, 1, 0] as [number, number, number], ankle: [0, 0, 0] as [number, number, number], target: [0.5, 0.5, 0] as [number, number, number], poleTarget: [0, 1, 1] as [number, number, number], originalQuaternions: original };

describe("leg IK fallback", () => {
  it("accepts a reachable target with a stable pole", () => {
    const result = solveLegIk(base);
    expect(result.status).toBe("accepted");
    expect(result.residualM).toBeLessThan(0.01);
  });
  it("keeps original quaternions for unreachable targets", () => {
    const result = solveLegIk({ ...base, target: [10, 0, 0] });
    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("target_unreachable");
    expect(result.localQuaternions).toEqual(original);
  });
});
