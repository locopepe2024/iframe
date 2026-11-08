import { expect, it } from "vitest";
import { mapDetectedFaces } from "../lib/whiteFaceAutoLandmarks";

it("uses eye-corner midpoints and the visible profile eye in either direction", () => {
    const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.4, z: 0 }));
    face[33] = { x: .2, y: .2, z: 0 };
    face[133] = { x: .4, y: .3, z: 0 };
    face[362] = { x: .6, y: .3, z: 0 };
    face[263] = { x: .8, y: .2, z: 0 };
    const front = mapDetectedFaces(face, undefined, [0, 1], [0, 1], 1);
    expect(front.frontLeftEye?.x).toBeCloseTo(.3);
    expect(front.frontLeftEye?.y).toBeCloseTo(.25);
    expect(front.frontRightEye?.x).toBeCloseTo(.7);

    face[133].x = .21; // Foreshortened far eye.
    face[168] = { x: .67, y: .32, z: 0 };
    face[199] = { x: .48, y: .7, z: 0 };
    face[152] = { x: .5, y: .8, z: 0 };
    const side = mapDetectedFaces(undefined, face, [0, 1], [0, 1], 1);
    expect(side.sideEye?.x).toBeCloseTo(.7);
    expect(side.sideNoseRoot).toEqual({ x: .67, y: .32 });
    expect(side.sideChin).toEqual({ x: .48, y: .7 });
    const mirrored = face.map(p => ({ ...p, x: 1 - p.x }));
    const reverse = mapDetectedFaces(undefined, mirrored, [0, 1], [0, 1], 1);
    expect(reverse.sideEye?.x).toBeCloseTo(.3);
    expect(reverse.sideNoseRoot?.x).toBeCloseTo(.33);
    expect(reverse.sideChin?.x).toBeCloseTo(.52);
    face[133].x = .4;
    face[263].x = .61;
    const oppositeEye = mapDetectedFaces(undefined, face, [0, 1], [0, 1], 1);
    expect(oppositeEye.sideEye?.x).toBeCloseTo(.3);
});

it("maps head-crop landmarks back to full three-view coordinates", () => {
    const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.4, z: 0 }));
    const front = mapDetectedFaces(face, undefined, [0, 0.34], [0.35, 0.66], 1223 / 1286, [0, 0.35]);
    const side = mapDetectedFaces(undefined, face, [0, 0.34], [0.35, 0.66], 1223 / 1286, [0, 0.35]);

    expect(front.frontLeftCheek?.x).toBeCloseTo(0.17);
    expect(front.frontLeftCheek?.y).toBeCloseTo(0.14);
    expect(side.sideEye?.x).toBeCloseTo(0.505);
    expect(side.sideEye?.y).toBeCloseTo(0.14);
    expect(side.sideNoseRoot?.x).toBeCloseTo(0.505);
    expect(side.sideNoseRoot?.y).toBeCloseTo(0.14);
});
