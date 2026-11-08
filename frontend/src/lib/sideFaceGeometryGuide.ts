import { faceShapeMeasurements, type FaceShape } from "./whiteFaceShape";
import { thinPlateMap, type GuideControls } from "./faceGeometryGuide";
import type { FaceFitLandmarks, FaceFitPoint } from "./whiteFaceFit";
import { validateFacePhotoView } from "./faceReferencePair";

export const SIDE_GUIDE_KEYS = ["noseRootHeight", "noseBridgeHeight", "noseProjection", "noseTipHeight", "chinProjection"];
export const SIDE_GUIDE_TRACK_IDS = [-1, 168, 197, 1, 199, 152, 13, 17];
const NOSE = [168, 6, 197, 195, 5, 4, 1, 2];
const LIPS = [0, 13, 14, 17];
const CHIN = [18, 200, 199, 175, 152];
const finite = (p: FaceFitPoint) => Number.isFinite(p?.x) && Number.isFinite(p?.y);

export function sideFaceGuidePrompt(name: string) {
    return `角色${name}的单人90°侧脸近景肖像，保持参考图的朝向、头部水平及中性表情，面部和肩部清晰。\n这张侧脸参考图已完成鼻根前突、鼻梁隆起、鼻尖突出及上下位置、下巴前突的二维几何调整。保持图中的侧面轮廓和五官位置，不再重复调整比例；仅细化自然肤理、发丝与光照，保持同一角色身份、发型和肤色。只呈现一个角色，不显示参考图、白模或对照排版。`;
}

/** Profile pixels only: no far-side landmarks or invented frontal depth. */
export function sideFaceGuideControls(face: FaceFitPoint[], shape: FaceShape, width: number, height: number,
    manual?: Partial<FaceFitLandmarks>): GuideControls {
    if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 2) throw new Error("侧脸原图尺寸无效");
    validateFacePhotoView(face, "side", width, height);
    const visible = Math.abs(face[133].x - face[33].x) > Math.abs(face[263].x - face[362].x) ? [33, 133, 159, 145] : [362, 263, 386, 374];
    const p = face.map(v => ({ x: v.x * width, y: v.y * height }));
    let eye = { x: (p[visible[0]].x + p[visible[1]].x) / 2, y: (p[visible[0]].y + p[visible[1]].y) / 2 };
    if (manual) {
        for (const key of ["sideEye", "sideNose", "sideChin"] as const) {
            const point = manual[key];
            if (!point || !finite(point) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error("已保存的侧脸点位无效，请重新拟合并核对");
        }
        const nextEye = { x: manual.sideEye!.x * width, y: manual.sideEye!.y * height };
        for (const id of visible) p[id] = { x: p[id].x + nextEye.x - eye.x, y: p[id].y + nextEye.y - eye.y };
        eye = nextEye;
        if (manual.sideNoseRoot) {
            if (!finite(manual.sideNoseRoot) || manual.sideNoseRoot.x < 0 || manual.sideNoseRoot.x > 1
                || manual.sideNoseRoot.y < 0 || manual.sideNoseRoot.y > 1) throw new Error("已保存的侧脸点位无效，请重新拟合并核对");
            p[168] = { x: manual.sideNoseRoot.x * width, y: manual.sideNoseRoot.y * height };
        }
        p[1] = { x: manual.sideNose!.x * width, y: manual.sideNose!.y * height };
        p[199] = { x: manual.sideChin!.x * width, y: manual.sideChin!.y * height };
    }
    const direction = Math.sign(p[1].x - eye.x), length = p[152].y - eye.y;
    const bridge = (p[197].x - eye.x) * direction, tip = Math.abs(p[1].x - eye.x);
    if (!direction || length < 2 || bridge < 1 || tip < 2 || p[197].y <= p[168].y || p[1].y <= p[197].y || p[2].y <= p[1].y) throw new Error("侧脸鼻梁或轮廓点位顺序无效，请核对原图");
    const m = Object.fromEntries(faceShapeMeasurements(shape).map(v => [v.key, v.target]));
    // Bound the root edit by the forehead and the visible brow, never by far-side points.
    const rootBoundary = m.noseRootHeight ? [9, 151, ...(visible[0] === 33 ? [105, 107] : [334, 336])] : [];
    const ids = [-1, ...visible, ...rootBoundary, ...NOSE, ...LIPS, ...CHIN];
    const source = ids.map(id => id === -1 ? eye : p[id]);
    if (source.some(v => !finite(v) || v.x < 8 || v.y < 8 || v.x > width - 9 || v.y > height - 9)) throw new Error("侧脸眼睛、鼻梁、鼻尖、嘴唇或下巴超出原图，请使用脸部完整且留白更多的侧脸照");
    const rootDx = direction * length * m.noseRootHeight / 100;
    const bridgeDx = direction * bridge * (m.noseBridgeHeight / 100 - 1);
    const tipDx = direction * tip * (m.noseProjection / 100 - 1), tipDy = length * m.noseTipHeight / 100;
    const chinDx = direction * length * m.chinProjection / 100;
    const interpolate = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
    const target = source.map((v, i) => {
        const id = ids[i];
        if (NOSE.includes(id)) {
            const upper = v.y <= p[197].y;
            const t = upper ? (v.y - p[168].y) / (p[197].y - p[168].y) : (v.y - p[197].y) / (p[1].y - p[197].y);
            const dx = upper ? interpolate(rootDx, bridgeDx, t) : interpolate(bridgeDx, tipDx, t);
            const weight = id === 2 ? .35 : Math.max(0, Math.min(1, (v.y - p[168].y) / (p[1].y - p[168].y)));
            return { x: v.x + (id === 2 ? tipDx * .35 : dx), y: v.y + tipDy * weight };
        }
        if (CHIN.includes(id)) return { x: v.x + chinDx * (id === 18 ? .25 : id === 152 ? .6 : 1), y: v.y };
        return { ...v };
    });
    const left = Math.max(0, Math.min(...source.map(v => v.x)) - length * .6);
    const right = Math.min(width - 1, Math.max(...source.map(v => v.x)) + length * .6);
    const top = Math.max(0, Math.min(...source.map(v => v.y)) - length * .5);
    const bottom = Math.min(height - 1, Math.max(...source.map(v => v.y)) + length * .4);
    if (target.some(v => !finite(v) || v.x <= left || v.x >= right || v.y <= top || v.y >= bottom)) throw new Error("侧脸调整超出可用区域，请减小幅度或增加原图留白");
    for (let step = 0; step <= 3; step++) {
        const x = left + (right - left) * step / 3, y = top + (bottom - top) * step / 3;
        for (const v of [{ x, y: top }, { x, y: bottom }, ...(step > 0 && step < 3 ? [{ x: left, y }, { x: right, y }] : [])]) {
            source.push(v); target.push({ ...v });
        }
    }
    // Early solve catches overlapping/degenerate manual and detected anchors.
    thinPlateMap(source, target);
    return { source, target, indices: ids };
}

export function sideGuideMeasurements(controls: GuideControls, points = controls.source) {
    const at = (id: number) => points[controls.indices.indexOf(id)];
    const eye = at(-1), root = at(168), tip = at(1), bridge = at(197), chin = at(199);
    const direction = Math.sign(controls.source[controls.indices.indexOf(1)].x - controls.source[0].x);
    return { noseRootHeight: (root.x - eye.x) * direction, noseBridgeHeight: (bridge.x - eye.x) * direction, noseProjection: (tip.x - eye.x) * direction,
        noseTipHeight: tip.y - eye.y, chinProjection: (chin.x - eye.x) * direction,
        length: at(152).y - eye.y };
}
