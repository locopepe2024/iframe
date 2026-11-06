import { describe, expect, it } from "vitest";
import { faceGuideControls, thinPlateMap, warpFacePixels, faceGuidePrompt, FACE_GUIDE_INTENT } from "../lib/faceGeometryGuide";
import { DEFAULT_FACE_SHAPE, faceShapeMeasurements } from "../lib/whiteFaceShape";

function face() {
    const f = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
    const points: Record<number, [number, number]> = {
        234: [.28, .48], 454: [.72, .48], 172: [.33, .65], 397: [.67, .65], 152: [.5, .77],
        33: [.35, .4], 133: [.43, .4], 159: [.39, .385], 145: [.39, .415],
        362: [.57, .4], 263: [.65, .4], 386: [.61, .385], 374: [.61, .415], 1: [.5, .54],
        196: [.48, .48], 419: [.52, .48], 45: [.475, .53], 275: [.525, .53], 129: [.44, .55], 358: [.56, .55],
        168: [.5, .41], 6: [.5, .45], 197: [.5, .48], 195: [.5, .50], 5: [.5, .515], 4: [.5, .53], 2: [.5, .56],
        61: [.42, .62], 291: [.58, .62], 0: [.5, .60], 13: [.5, .62], 14: [.5, .63], 17: [.5, .65],
    };
    for (const [index, [x, y]] of Object.entries(points)) f[Number(index)] = { x, y };
    const extras = [19, 94, 122, 351, 174, 399, 198, 420, 51, 281, 44, 274, 49, 279, 48, 278, 64, 294, 98, 327, 97, 326];
    extras.forEach((id, i) => { const row = Math.floor(i / 2); f[id] = { x: .5 + (i % 2 ? 1 : -1) * (.025 + row * .003), y: .44 + row * .012 }; });
    const contour = [93, 132, 58, 136, 150, 149, 176, 148, 377, 400, 378, 379, 365, 288, 361, 323];
    contour.forEach((id, i) => {
        const angle = Math.PI * (.06 + .88 * i / (contour.length - 1));
        f[id] = { x: .5 - .21 * Math.cos(angle), y: .48 + .29 * Math.sin(angle) };
    });
    return f;
}

describe("face geometry guide", () => {
    it.each([75, 125])("applies measured nasal widths and vertical position for control %s", value => {
        const shape = { ...DEFAULT_FACE_SHAPE, noseBridgeWidth: value, noseTipWidth: value, nostrilWidth: value, noseTipHeight: value };
        const c = faceGuideControls(face(), shape, 800, 1000);
        const measures = Object.fromEntries(faceShapeMeasurements(shape).map(m => [m.key, m.target]));
        for (const [key, a, b] of [["noseBridgeWidth", 196, 419], ["noseTipWidth", 45, 275], ["nostrilWidth", 129, 358]] as const) {
            const i = c.indices.indexOf(a), j = c.indices.indexOf(b);
            expect(i).toBeGreaterThanOrEqual(0); expect(j).toBeGreaterThanOrEqual(0);
            expect((c.target[j].x - c.target[i].x) / (c.source[j].x - c.source[i].x)).toBeCloseTo(measures[key] / 100);
        }
        const tip = c.indices.indexOf(1);
        expect((c.target[tip].y - c.source[tip].y) / 370 * 100).toBeCloseTo(measures.noseTipHeight);
    });
    it("maps image landmarks to the measured combined targets, preserving local eye shape", () => {
        const shape = { ...DEFAULT_FACE_SHAPE, faceLength: 90, faceWidth: 120, cheekWidth: 117, jawWidth: 75, eyeSpacing: 80 };
        const c = faceGuideControls(face(), shape, 800, 1000);
        const measures = Object.fromEntries(faceShapeMeasurements(shape).map(m => [m.key, m.target]));
        expect((c.target[1].x - c.target[0].x) / (c.source[1].x - c.source[0].x)).toBeCloseTo(measures.cheekWidth / 100);
        expect((c.target[3].x - c.target[2].x) / (c.source[3].x - c.source[2].x)).toBeCloseTo(measures.jawWidth / 100);
        expect((c.target[4].y - 400) / (c.source[4].y - 400)).toBeCloseTo(measures.faceLength / 100);
        expect(c.target[6].x - c.target[5].x).toBeCloseTo(c.source[6].x - c.source[5].x);
        const map = thinPlateMap(c.source, c.target);
        c.source.forEach((p, i) => { expect(map(p).x).toBeCloseTo(c.target[i].x, 6); expect(map(p).y).toBeCloseTo(c.target[i].y, 6); });
        const inverse = thinPlateMap(c.target, c.source);
        c.target.forEach((p, i) => expect(inverse(p).x).toBeCloseTo(c.source[i].x, 6));
    });

    it("keeps neutral pixels exact and rejects invalid or oblique faces", () => {
        const c = faceGuideControls(face(), DEFAULT_FACE_SHAPE, 80, 100);
        const pixels = Uint8ClampedArray.from({ length: 80 * 100 * 4 }, (_, i) => i % 255);
        expect(warpFacePixels(pixels, 80, 100, c)).toEqual(pixels);
        const oblique = face(); oblique[1].x = .7;
        expect(() => faceGuideControls(oblique, DEFAULT_FACE_SHAPE, 80, 100)).toThrow(/正面/);
        expect(() => faceGuideControls([], DEFAULT_FACE_SHAPE, 80, 100)).toThrow(/点位/);
        expect(() => thinPlateMap([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }])).toThrow(/退化/);
    });

    it("resamples pixels and preserves the background outside the face region", () => {
        const shape = { ...DEFAULT_FACE_SHAPE, cheekWidth: 117, jawWidth: 75 };
        const c = faceGuideControls(face(), shape, 80, 100);
        const pixels = Uint8ClampedArray.from({ length: 80 * 100 * 4 }, (_, i) => i % 255);
        const warped = warpFacePixels(pixels, 80, 100, c);
        expect(warped).not.toEqual(pixels);
        expect(warped.slice(0, 80 * 4)).toEqual(pixels.slice(0, 80 * 4));
    });

    it("tells refinement to preserve the already-adjusted guide rather than reapplying numbers", () => {
        expect(faceGuidePrompt("苏砚")).toContain(FACE_GUIDE_INTENT);
        expect(faceGuidePrompt("苏砚")).not.toContain("骨相测量目标：");
    });
});
