import { expect, it } from "vitest";
import { trackGuidePixels } from "../lib/faceGuidePixelCheck";

it("finds translated texture in actual pixels, and rejects unchanged, flat or corrupt output", () => {
    const width = 90, height = 80;
    let seed = 123;
    const original = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return i % 4 === 3 ? 255 : seed >>> 24;
    });
    const output = new Uint8ClampedArray(original.length);
    for (let y = 0; y < height - 3; y++) for (let x = 0; x < width - 4; x++) {
        output.set(original.slice((y * width + x) * 4, (y * width + x + 1) * 4), ((y + 3) * width + x + 4) * 4);
    }
    const source = [{ x: 30, y: 30 }, { x: 50, y: 30 }, { x: 40, y: 50 }];
    const controls = { source, target: source.map(p => ({ x: p.x + 4, y: p.y + 3 })), indices: [1, 2, 3] };
    const tracks = trackGuidePixels(original, output, width, height, controls, [1, 2, 3]);
    for (const [id, track] of Array.from(tracks)) {
        expect(track.reliable).toBe(true);
        expect(track.point.x).toBeCloseTo(controls.target[id - 1].x);
        expect(track.point.y).toBeCloseTo(controls.target[id - 1].y);
    }
    expect(Array.from(trackGuidePixels(original, original, width, height, controls, [1, 2, 3]).values()).every(t => !t.reliable)).toBe(true);
    const flat = new Uint8ClampedArray(original.length).fill(100);
    expect(trackGuidePixels(flat, flat, width, height, controls, [1]).get(1)?.reliable).toBe(false);
    expect(trackGuidePixels(original, flat, width, height, controls, [1]).get(1)?.reliable).toBe(false);
});
