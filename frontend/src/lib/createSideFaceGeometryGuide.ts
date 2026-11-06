import { autoMarkFacePhoto } from "./whiteFaceAutoLandmarks";
import { warpFacePixels } from "./faceGeometryGuide";
import { SIDE_GUIDE_KEYS, SIDE_GUIDE_TRACK_IDS, sideFaceGuideControls, sideGuideMeasurements } from "./sideFaceGeometryGuide";
import { trackGuidePixels } from "./faceGuidePixelCheck";
import { faceShapeMeasurements, type FaceShape } from "./whiteFaceShape";
import type { FaceGeometryGuide, FaceGuideCheck } from "./createFaceGeometryGuide";

async function blobOf(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("无法导出侧脸引导图")), "image/png"));
}

/** Always warp original profile pixels once. The output must pass both pose and independent texture checks. */
export async function createSideFaceGeometryGuide(image: HTMLImageElement, shape: FaceShape,
    progress: (message: string) => void = () => {}): Promise<FaceGeometryGuide> {
    const measures = faceShapeMeasurements(shape);
    if (!measures.some(v => SIDE_GUIDE_KEYS.includes(v.key) && v.target !== v.baseline)) throw new Error("当前没有可应用的侧面深度或鼻尖位置调整");
    if (!shape.calibration?.referencePair || !shape.calibration.reviewed) throw new Error("请先保存并核对独立正面与侧脸双图拟合");
    const saved = shape.calibration.referencePair.side;
    if (saved.sourceWidth !== image.naturalWidth || saved.sourceHeight !== image.naturalHeight) throw new Error("侧脸原图尺寸与保存记录不一致，请重新拟合");
    progress("正在核对侧脸视角和点位…");
    const detected = await autoMarkFacePhoto(image, "side");
    const scale = Math.min(1, 1536 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * scale), height = Math.round(image.naturalHeight * scale);
    const controls = sideFaceGuideControls(detected.face, shape, width, height, shape.calibration.landmarks);
    const before = sideGuideMeasurements(controls);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("无法读取侧脸像素");
    context.drawImage(image, 0, 0, width, height);
    const original = context.getImageData(0, 0, width, height);
    progress("正在调整侧脸轮廓并核对实际输出像素…");
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const output = context.createImageData(width, height);
    output.data.set(warpFacePixels(original.data, width, height, controls, true));
    context.putImageData(output, 0, 0);
    const blob = await blobOf(canvas), url = URL.createObjectURL(blob);
    try {
        const result = new Image(); result.src = url; await result.decode();
        await autoMarkFacePhoto(result, "side");
    } finally { URL.revokeObjectURL(url); }
    const tracks = trackGuidePixels(original.data, output.data, width, height, controls, SIDE_GUIDE_TRACK_IDS, true);
    const pixelCheckPassed = Array.from(tracks.values()).every(v => v.reliable);
    const tracked = controls.source.map((v, i) => tracks.get(controls.indices[i])?.point || v);
    const after = sideGuideMeasurements(controls, tracked);
    const desired = Object.fromEntries(measures.map(v => [v.key, v.target]));
    const labels = { noseBridgeHeight: "鼻梁前缘至眼轴", noseProjection: "鼻尖至眼轴",
        noseTipHeight: "鼻尖上下位移（向下为正）", chinProjection: "下巴前突位移（向鼻尖为正）" };
    const checks: FaceGuideCheck[] = SIDE_GUIDE_KEYS.map(key => {
        const k = key as keyof typeof labels;
        const position = k === "noseTipHeight" || k === "chinProjection";
        const observed = position ? (after[k] - before[k]) / before.length * 100 : after[k] / before[k] * 100;
        return { key, label: labels[k], target: desired[key], observed,
            error: position ? Math.abs(observed - desired[key]) : Math.abs(observed / desired[key] - 1),
            ...(position ? { unit: "position" as const } : {}) };
    });
    const xs = controls.source.slice(0, controls.indices.length).map(v => v.x);
    const ys = controls.source.slice(0, controls.indices.length).map(v => v.y);
    const x = Math.max(0, Math.floor(Math.min(...xs) - before.length * .3));
    const y = Math.max(0, Math.floor(Math.min(...ys) - before.length * .15));
    const cropWidth = Math.min(width - x, Math.ceil(Math.max(...xs) - x + before.length * .3));
    const cropHeight = Math.min(height - y, Math.ceil(Math.max(...ys) - y + before.length * .15));
    const comparison: Blob[] = [];
    for (const pixels of [original, output]) {
        const full = document.createElement("canvas"); full.width = width; full.height = height; full.getContext("2d")!.putImageData(pixels, 0, 0);
        const crop = document.createElement("canvas"); crop.width = cropWidth; crop.height = cropHeight;
        crop.getContext("2d")!.drawImage(full, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        comparison.push(await blobOf(crop));
    }
    return { blob, sourceFaceHeight: detected.prepared.sourceFaceHeight, iterations: 1, pixelCheckPassed, checks,
        textureChecks: Array.from(tracks.entries()).map(([id, v]) => ({ id, error: v.error, textureError: v.textureError, reliable: v.reliable })),
        verified: pixelCheckPassed && checks.every(v => Number.isFinite(v.error) && v.error <= (v.unit === "position" ? 1 : .05)),
        noseComparison: { original: comparison[0], guide: comparison[1] },
        omitted: measures.filter(v => v.target !== v.baseline && !SIDE_GUIDE_KEYS.includes(v.key)).map(v => v.label) };
}
