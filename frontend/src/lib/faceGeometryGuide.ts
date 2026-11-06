import { faceShapeMeasurements, type FaceShape } from "./whiteFaceShape";
import type { FaceFitPoint } from "./whiteFaceFit";

type Point = FaceFitPoint;
export type GuideControls = { source: Point[]; target: Point[]; indices: number[] };
export const GUIDE_KEYS = ["faceLength", "cheekWidth", "jawWidth", "eyeSpacing", "cheekHeight", "jawHeight",
    "noseBridgeWidth", "noseTipWidth", "nostrilWidth", "noseTipHeight"];
export const FACE_GUIDE_INTENT = "这张参考图已完成正面骨相几何调整。保持图中的眼线至下巴长度、颧部宽度、下颌宽度、眼距、鼻梁宽度、鼻尖宽度、鼻翼宽度和鼻尖上下位置，不再重复调整比例；仅细化自然肤理、发丝与光照，保持同一角色身份、发型和肤色。只呈现一个角色，不显示参考图、白模或对照排版。";
export const GUIDE_NOSE_PAIRS = { noseBridgeWidth: [196, 419], noseTipWidth: [45, 275], nostrilWidth: [129, 358] } as const;

/** Explicitly replaces numerical edit instructions: the guide already contains these edits. */
export function faceGuidePrompt(name: string) {
    return `角色${name}的正面近景肖像，面部和肩部清晰，采用中性表情，正面看向镜头。\n${FACE_GUIDE_INTENT}`;
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const finite = (p: Point) => Number.isFinite(p?.x) && Number.isFinite(p?.y);

/** Coordinates are in pixels. Eyes retain their local shape while their centers move. */
export function faceGuideControls(face: Point[], shape: FaceShape, width: number, height: number): GuideControls {
    if (face.length < 468 || face.some(p => !finite(p) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
        || !Number.isFinite(width) || !Number.isFinite(height) || Math.min(width, height) <= 0) throw new Error("人脸点位或图像尺寸无效");
    const sourceFace = face.map(p => ({ x: p.x * width, y: p.y * height }));
    const leftEye = mid(sourceFace[33], sourceFace[133]), rightEye = mid(sourceFace[362], sourceFace[263]);
    const center = mid(leftEye, rightEye), faceLength = sourceFace[152].y - center.y;
    const eyeDistance = rightEye.x - leftEye.x, cheekWidth = sourceFace[454].x - sourceFace[234].x;
    if (faceLength <= 1 || cheekWidth <= 1 || eyeDistance <= 1) throw new Error("正脸点位顺序无效");
    const leftWidth = sourceFace[133].x - sourceFace[33].x, rightWidth = sourceFace[263].x - sourceFace[362].x;
    if (Math.abs(rightEye.y - leftEye.y) / eyeDistance > .12
        || leftWidth / rightWidth < .65 || leftWidth / rightWidth > 1.54
        || Math.abs(sourceFace[1].x - center.x) / eyeDistance > .24) throw new Error("请使用正面且头部平正的单人头像，侧脸或明显倾斜不能制作正面引导图");
    if (Object.values(GUIDE_NOSE_PAIRS).some(([a, b]) => sourceFace[b].x - sourceFace[a].x <= 1)
        || sourceFace[45].y <= sourceFace[196].y || sourceFace[1].y <= sourceFace[168].y) throw new Error("鼻部点位无效，请换用清晰正脸");
    const measurements = Object.fromEntries(faceShapeMeasurements(shape).map(m => [m.key, m.target]));
    const lengthRatio = measurements.faceLength / 100;
    const indices = [234, 454, 172, 397, 152, 33, 133, 159, 145, 362, 263, 386, 374];
    const source = indices.map(i => sourceFace[i]);
    const target = source.map((p, index) => {
        const id = indices[index];
        if (id === 152) return { x: p.x, y: center.y + faceLength * lengthRatio };
        const pair = id === 234 || id === 454 ? [234, 454, "cheekWidth", "cheekHeight"] as const
            : id === 172 || id === 397 ? [172, 397, "jawWidth", "jawHeight"] as const : null;
        if (pair) {
            const c = mid(sourceFace[pair[0]], sourceFace[pair[1]]);
            return { x: c.x + (p.x - c.x) * measurements[pair[2]] / 100,
                y: p.y + measurements[pair[3]] / 100 * faceLength };
        }
        const eye = index < 9 ? leftEye : rightEye;
        return { x: p.x + (eye.x - center.x) * (measurements.eyeSpacing / 100 - 1), y: p.y };
    });
    // Fixed perimeter prevents changes from spreading to clothes/background.
    const xs = source.map(p => p.x), ys = source.map(p => p.y);
    const margin = cheekWidth * .45;
    const left = Math.max(0, Math.min(...xs) - margin), right = Math.min(width - 1, Math.max(...xs) + margin);
    const top = Math.max(0, Math.min(...ys) - faceLength * .85), bottom = Math.min(height - 1, Math.max(...ys) + margin);
    for (let step = 0; step <= 3; step++) {
        const x = step === 3 ? right : left + (right - left) * step / 3, y = step === 3 ? bottom : top + (bottom - top) * step / 3;
        for (const p of [{ x, y: top }, { x, y: bottom }, ...(step > 0 && step < 3 ? [{ x: left, y }, { x: right, y }] : [])]) {
            source.push(p); target.push({ ...p });
        }
    }
    if (target.some(p => !finite(p) || p.x < left || p.x > right || p.y < top || p.y > bottom)
        || target[1].x <= target[0].x || target[3].x <= target[2].x || target[4].y <= center.y) throw new Error("目标超出可用图像区域，请减小调整幅度或换用留白更多的头像");
    // Attach the intervening jaw contour as well: isolated angle points can
    // move while a detector continues to follow the original surrounding edge.
    const contour = [93, 132, 58, 136, 150, 149, 176, 148, 377, 400, 378, 379, 365, 288, 361, 323];
    const forward = thinPlateMap(source, target);
    const extraSource = contour.map(index => sourceFace[index]);
    source.splice(indices.length, 0, ...extraSource);
    target.splice(indices.length, 0, ...extraSource.map(forward));
    indices.push(...contour);
    const baseMap = thinPlateMap(source, target);
    // Keep the mouth at the contour-only position. Nasal edits must not drag lips.
    const mouth = [61, 291, 0, 13, 14, 17];
    const nose = NOSE_CONTROLS;
    for (const id of [...mouth, ...nose]) {
        const p = sourceFace[id];
        const next = nose.includes(id) ? nasalTarget(p, sourceFace, measurements, faceLength) : baseMap(p);
        source.splice(indices.length, 0, p); target.splice(indices.length, 0, next); indices.push(id);
    }
    if (target.some(p => !finite(p) || p.x < left || p.x > right || p.y < top || p.y > bottom)) throw new Error("鼻部目标超出可用图像区域，请减小幅度后重试");
    return { source, target, indices };
}

const NOSE_CONTROLS = [168, 6, 197, 195, 5, 4, 1, 2, 19, 94,
    122, 351, 196, 419, 174, 399, 198, 420, 51, 281, 45, 275,
    44, 274, 49, 279, 48, 278, 129, 358, 64, 294, 98, 327, 97, 326];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Move the surrounding nasal texture with each interval, not just two isolated pixels. */
function nasalTarget(p: Point, face: Point[], m: Record<string, number>, length: number): Point {
    const cx = (face[196].x + face[419].x) / 2;
    const bridgeY = (face[196].y + face[419].y) / 2, tipY = (face[45].y + face[275].y) / 2;
    const t = clamp((p.y - bridgeY) / (tipY - bridgeY));
    const radius = lerp((face[419].x - face[196].x) / 2, (face[275].x - face[45].x) / 2, t);
    const outer = (face[358].x - face[129].x) / 2;
    const innerDelta = radius * (lerp(m.noseBridgeWidth, m.noseTipWidth, t) / 100 - 1);
    const outerDelta = outer * (lerp(100, m.nostrilWidth, t) / 100 - 1);
    const x = Math.abs(p.x - cx);
    const delta = x <= radius ? innerDelta * x / radius
        : x <= outer ? lerp(innerDelta, outerDelta, (x - radius) / (outer - radius))
        : outerDelta * (1 - clamp((x - outer) / outer));
    const weight = clamp((p.y - face[168].y) / (face[1].y - face[168].y));
    return { x: p.x + Math.sign(p.x - cx) * delta, y: p.y + m.noseTipHeight / 100 * length * weight };
}

function solve(matrix: number[][], rhs: number[][]) {
    const a = matrix.map((row, i) => [...row, ...rhs[i]]), n = a.length;
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
        if (Math.abs(a[pivot][col]) < 1e-10) throw new Error("人脸变形点位退化，请换用清晰正脸");
        [a[col], a[pivot]] = [a[pivot], a[col]];
        const divisor = a[col][col];
        for (let k = col; k < n + 2; k++) a[col][k] /= divisor;
        for (let row = 0; row < n; row++) if (row !== col) {
            const factor = a[row][col];
            for (let k = col; k < n + 2; k++) a[row][k] -= factor * a[col][k];
        }
    }
    return a.map(row => row.slice(n));
}
const kernel = (a: Point, b: Point) => { const r = (a.x - b.x) ** 2 + (a.y - b.y) ** 2; return r < 1e-16 ? 0 : r * Math.log(r); };

/** Smooth interpolation with exact anatomical control correspondences. */
export function thinPlateMap(from: Point[], to: Point[]) {
    if (from.length !== to.length || from.length < 3 || [...from, ...to].some(p => !finite(p))) throw new Error("变形点位无效");
    const origin = from[0], scale = Math.max(...from.map(p => Math.hypot(p.x - origin.x, p.y - origin.y)));
    if (scale < 1e-6) throw new Error("变形点位退化");
    const points = from.map(p => ({ x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale })), n = points.length;
    const matrix = Array.from({ length: n + 3 }, () => Array(n + 3).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) matrix[i][j] = kernel(points[i], points[j]);
        matrix[i][n] = matrix[n][i] = 1;
        matrix[i][n + 1] = matrix[n + 1][i] = points[i].x;
        matrix[i][n + 2] = matrix[n + 2][i] = points[i].y;
    }
    const coefficients = solve(matrix, [...to.map((p, i) => [(p.x - from[i].x) / scale, (p.y - from[i].y) / scale]), [0, 0], [0, 0], [0, 0]]);
    return (p: Point): Point => {
        const q = { x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale };
        const delta = [0, 1].map(axis => coefficients[n][axis] + coefficients[n + 1][axis] * q.x + coefficients[n + 2][axis] * q.y);
        for (let i = 0; i < n; i++) { const weight = kernel(q, points[i]); delta[0] += coefficients[i][0] * weight; delta[1] += coefficients[i][1] * weight; }
        return { x: p.x + delta[0] * scale, y: p.y + delta[1] * scale };
    };
}

/** Bilinear inverse resampling. A coarse field avoids evaluating a spline per pixel. */
export function warpFacePixels(pixels: Uint8ClampedArray, width: number, height: number, controls: GuideControls) {
    if (pixels.length !== width * height * 4) throw new Error("图像像素尺寸不匹配");
    const result = new Uint8ClampedArray(pixels);
    if (controls.source.every((p, i) => Math.hypot(p.x - controls.target[i].x, p.y - controls.target[i].y) < 1e-8)) return result;
    const map = thinPlateMap(controls.target, controls.source);
    const left = Math.floor(Math.min(...controls.source.map(p => p.x))), top = Math.floor(Math.min(...controls.source.map(p => p.y)));
    const right = Math.ceil(Math.max(...controls.source.map(p => p.x))), bottom = Math.ceil(Math.max(...controls.source.map(p => p.y)));
    const step = 4, cols = Math.ceil((right - left) / step) + 1, rows = Math.ceil((bottom - top) / step) + 1;
    const grid = Array.from({ length: rows }, (_, j) => Array.from({ length: cols }, (_, i) => map({ x: Math.min(right, left + i * step), y: Math.min(bottom, top + j * step) })));
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i], d = grid[j + 1][i + 1];
        const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        if (![a, b, c, d].every(finite) || cross(a, b, c) <= 0 || cross(b, d, c) <= 0) throw new Error("调整幅度造成图像折叠，请减小幅度后重试");
    }
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const i = Math.floor((x - left) / step), j = Math.floor((y - top) / step);
        const tx = (x - left - i * step) / Math.min(step, right - left - i * step), ty = (y - top - j * step) / Math.min(step, bottom - top - j * step);
        const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i], d = grid[j + 1][i + 1];
        // Fade only near the fixed image perimeter; all anatomical nodes are inside.
        const fade = Math.min(1, (x - left) / 24, (right - x) / 24, (y - top) / 24, (bottom - y) / 24);
        const sx = Math.max(0, Math.min(width - 1, x + ((a.x * (1 - tx) + b.x * tx) * (1 - ty) + (c.x * (1 - tx) + d.x * tx) * ty - x) * fade));
        const sy = Math.max(0, Math.min(height - 1, y + ((a.y * (1 - tx) + b.y * tx) * (1 - ty) + (c.y * (1 - tx) + d.y * tx) * ty - y) * fade));
        const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
        const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
        for (let ch = 0; ch < 4; ch++) result[(y * width + x) * 4 + ch] =
            (pixels[(y0 * width + x0) * 4 + ch] * (1 - fx) + pixels[(y0 * width + x1) * 4 + ch] * fx) * (1 - fy)
            + (pixels[(y1 * width + x0) * 4 + ch] * (1 - fx) + pixels[(y1 * width + x1) * 4 + ch] * fx) * fy;
    }
    return result;
}

export function frontGuideRatios(face: Point[], width: number, height: number) {
    const p = face.map(p => ({ x: p.x * width, y: p.y * height }));
    const eyeY = (p[33].y + p[133].y + p[362].y + p[263].y) / 4;
    const cheek = p[454].x - p[234].x;
    return { faceLength: (p[152].y - eyeY) / cheek, jawWidth: (p[397].x - p[172].x) / cheek,
        eyeSpacing: ((p[362].x + p[263].x - p[33].x - p[133].x) / 2) / cheek,
        noseBridgeWidth: (p[419].x - p[196].x) / cheek,
        noseTipWidth: (p[275].x - p[45].x) / cheek, nostrilWidth: (p[358].x - p[129].x) / cheek };
}

/** Signed image position, normalized by the original eye-line-to-chin length. */
export function frontNosePosition(face: Point[], width: number, height: number) {
    void width;
    const eyeY = (face[33].y + face[133].y + face[362].y + face[263].y) / 4;
    return { tipY: (face[1].y - eyeY) * height, length: (face[152].y - eyeY) * height };
}

/** Correct detector drift using fresh output marks; always warp original pixels. */
export function correctGuideControls(current: GuideControls, wanted: GuideControls, detected: Point[], width: number, height: number): GuideControls {
    const actual = detected.map(p => ({ x: p.x * width, y: p.y * height }));
    const target = current.target.map(p => ({ ...p }));
    for (let i = 0; i < 5; i++) {
        const observed = actual[wanted.indices[i]];
        target[i].x += wanted.target[i].x - observed.x;
        target[i].y += wanted.target[i].y - observed.y;
    }
    for (const [start, end] of [[5, 9], [9, 13]]) {
        const goal = mid(wanted.target[start], wanted.target[start + 1]);
        const observed = mid(actual[wanted.indices[start]], actual[wanted.indices[start + 1]]);
        for (let i = start; i < end; i++) { target[i].x += goal.x - observed.x; target[i].y += goal.y - observed.y; }
    }
    for (let i = 13; i < wanted.indices.length; i++) {
        const id = wanted.indices[i];
        // In portrait verification, nasal width estimates barely followed local edits.
        // Repeated correction distorted pixels without reaching those estimates.
        if (NOSE_CONTROLS.includes(id)) continue;
        target[i].x += wanted.target[i].x - actual[id].x;
        target[i].y += wanted.target[i].y - actual[id].y;
    }
    return { ...current, target };
}
