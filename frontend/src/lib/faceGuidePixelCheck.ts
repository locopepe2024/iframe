import { thinPlateMap, type GuideControls } from "./faceGeometryGuide";
import type { FaceFitPoint } from "./whiteFaceFit";

const gray = (pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return NaN;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const at = (dx: number, dy: number) => {
        const i = ((iy + dy) * width + ix + dx) * 4;
        return .299 * pixels[i] + .587 * pixels[i + 1] + .114 * pixels[i + 2];
    };
    return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy)
        + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
};

export type PixelTrack = { point: FaceFitPoint; error: number; textureError: number; reliable: boolean };

/** Locate original texture in the rendered pixels. This checks the image, not a re-detected 3D nose prior. */
export function trackGuidePixels(original: Uint8ClampedArray, output: Uint8ClampedArray, width: number, height: number,
    controls: GuideControls, ids: number[], exactPatch = false): Map<number, PixelTrack> {
    const forward = thinPlateMap(controls.source, controls.target);
    const tracks = new Map<number, PixelTrack>();
    for (const id of ids) {
        const index = controls.indices.indexOf(id);
        if (index < 0) throw new Error("缺少鼻部像素核对点");
        const source = controls.source[index], expected = controls.target[index];
        const dx = forward({ x: source.x + 1, y: source.y }), dy = forward({ x: source.x, y: source.y + 1 });
        const samples: Array<{ value: number; x: number; y: number }> = [];
        for (let y = -6; y <= 6; y += 2) for (let x = -6; x <= 6; x += 2) {
            const warped = exactPatch ? forward({ x: source.x + x, y: source.y + y }) : undefined;
            samples.push({ value: gray(original, width, height, source.x + x, source.y + y),
                x: warped ? warped.x - expected.x : (dx.x - expected.x) * x + (dy.x - expected.x) * y,
                y: warped ? warped.y - expected.y : (dx.y - expected.y) * x + (dy.y - expected.y) * y });
        }
        const mean = samples.reduce((sum, s) => sum + s.value, 0) / samples.length;
        const variance = samples.reduce((sum, s) => sum + (s.value - mean) ** 2, 0);
        const score = (x: number, y: number) => {
            const values = samples.map(s => gray(output, width, height, expected.x + s.x + x, expected.y + s.y + y));
            const average = values.reduce((a, b) => a + b, 0) / values.length;
            return samples.reduce((sum, s, i) => sum + (values[i] - average - s.value + mean) ** 2, 0) / variance;
        };
        let best = { x: 0, y: 0, score: Infinity };
        // Include the old position when practical: an unchanged output must not pass.
        const radius = Math.min(12, Math.max(3, Math.ceil(Math.hypot(source.x - expected.x, source.y - expected.y)) + 1));
        for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
            const value = score(x, y);
            if (value < best.score) best = { x, y, score: value };
        }
        const coarse = best;
        for (let y = coarse.y - .8; y <= coarse.y + .81; y += .2) for (let x = coarse.x - .8; x <= coarse.x + .81; x += .2) {
            const value = score(x, y);
            if (value < best.score) best = { x, y, score: value };
        }
        const error = Math.hypot(best.x, best.y);
        tracks.set(id, { point: { x: expected.x + best.x, y: expected.y + best.y }, error, textureError: best.score,
            reliable: variance / samples.length >= 1 && Number.isFinite(best.score) && best.score <= .25 && error <= .8 });
    }
    return tracks;
}
