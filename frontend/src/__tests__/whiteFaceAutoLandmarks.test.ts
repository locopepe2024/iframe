import { expect, it } from "vitest";
import { mapDetectedFaces } from "../lib/whiteFaceAutoLandmarks";

it("maps head-crop landmarks back to full three-view coordinates", () => {
    const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.4, z: 0 }));
    const front = mapDetectedFaces(face, undefined, [0, 0.34], [0.35, 0.66], 1223 / 1286, [0, 0.35]);
    const side = mapDetectedFaces(undefined, face, [0, 0.34], [0.35, 0.66], 1223 / 1286, [0, 0.35]);

    expect(front.frontLeftCheek?.x).toBeCloseTo(0.17);
    expect(front.frontLeftCheek?.y).toBeCloseTo(0.14);
    expect(side.sideEye?.x).toBeCloseTo(0.505);
    expect(side.sideEye?.y).toBeCloseTo(0.14);
});
