import { expect, it } from "vitest";
import { describeSceneDirection, sceneAngles, sceneDirection } from "../lib/sceneDirection";

it("uses the director Z-up frame for all six cardinal directions", () => {
    for (const [a, e, expected] of [
        [0, 0, [0, -1, 0]], [90, 0, [1, 0, 0]], [-90, 0, [-1, 0, 0]],
        [180, 0, [0, 1, 0]], [0, 90, [0, 0, 1]], [0, -90, [0, 0, -1]],
    ] as const) sceneDirection(a, e).forEach((v, i) => expect(v).toBeCloseTo(expected[i]));
});

it("roundtrips arbitrary directions and preserves azimuth at poles", () => {
    for (const a of [-180, -135, -45, 0, 45, 90, 180]) for (const e of [-80, -30, 0, 30, 80]) {
        const next = sceneAngles(sceneDirection(a, e));
        expect(next.azimuth).toBeCloseTo(a); expect(next.elevation).toBeCloseTo(e);
        expect(Math.hypot(...sceneDirection(a, e))).toBeCloseTo(1);
    }
    expect(sceneAngles([0, 0, 1], 135)).toEqual({ azimuth: 135, elevation: 90 });
    expect(() => sceneAngles([0, 0, 0])).toThrow();
    expect(describeSceneDirection(45, 30)).toBe("右前方上方");
    expect(describeSceneDirection(-135, -30)).toBe("左后方下方");
});
