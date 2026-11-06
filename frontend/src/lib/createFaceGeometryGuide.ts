import { detectFrontFaceGuide } from "./whiteFaceAutoLandmarks";
import { faceGuideControls, warpFacePixels, correctGuideControls, frontGuideRatios, frontNosePosition, GUIDE_KEYS, GUIDE_NOSE_PAIRS } from "./faceGeometryGuide";
import { trackGuidePixels } from "./faceGuidePixelCheck";
import { faceShapeMeasurements, type FaceShape } from "./whiteFaceShape";
import { FACE_FIT_IMAGE_SPEC, frontReferenceBounds, type FrontReferenceRegion } from "./whiteFaceImage";

export type FaceGuideCheck = { key: string; label: string; target: number; observed: number; error: number; unit?: "position"; detectorEstimate?: number };
export type FaceGeometryGuide = {
    blob: Blob; sourceFaceHeight: number; verified: boolean; iterations: number;
    checks: FaceGuideCheck[]; omitted: string[];
    noseComparison?: { original: Blob; guide: Blob }; pixelCheckPassed?: boolean;
    textureChecks?: Array<{ id: number; error: number; textureError: number; reliable: boolean }>;
};

async function canvasImage(canvas: HTMLCanvasElement) {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("无法导出骨相引导图")), "image/png"));
    const url = URL.createObjectURL(blob);
    try { const image = new Image(); image.src = url; await image.decode(); return { image, blob }; }
    finally { URL.revokeObjectURL(url); }
}

/** Local-only preprocessing and independent output re-detection; never submits generation. */
export async function createFaceGeometryGuide(image: HTMLImageElement, shape: FaceShape, region: FrontReferenceRegion,
    progress: (message: string) => void = () => {}) : Promise<FaceGeometryGuide> {
    const measurements = faceShapeMeasurements(shape);
    if (!measurements.some(item => GUIDE_KEYS.includes(item.key) && item.target !== item.baseline)) throw new Error("当前没有可应用的正面轮廓调整；鼻部深度等参数暂不支持引导图变形");
    progress("正在识别原始正脸…");
    const source = await detectFrontFaceGuide(image, region);
    const sourceFaceHeight = source.prepared.sourceFaceHeight;
    if (sourceFaceHeight < FACE_FIT_IMAGE_SPEC.minimumFaceHeight) throw new Error(`原始人脸高度约${Math.round(sourceFaceHeight)}像素，低于128像素，请选择清晰头像原图`);
    const bounds = frontReferenceBounds(image.naturalWidth, image.naturalHeight, region);
    const scale = Math.min(1, 1536 / Math.max(bounds.width, bounds.height));
    const width = Math.round(bounds.width * scale), height = Math.round(bounds.height * scale);
    const sourceFace = source.face.map(p => ({ ...p, x: (p.x * image.naturalWidth - bounds.x) / bounds.width,
        y: (p.y * image.naturalHeight - bounds.y) / bounds.height }));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取人脸图像");
    context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, width, height);
    const original = context.getImageData(0, 0, width, height);
    const wanted = faceGuideControls(sourceFace, shape, width, height);
    let controls = wanted;
    const m = Object.fromEntries(measurements.map(item => [item.key, item.target]));
    const before = frontGuideRatios(sourceFace, width, height);
    const labels = { faceLength: "脸长／颧宽", jawWidth: "下颌宽／颧宽", eyeSpacing: "眼距／颧宽",
        noseBridgeWidth: "鼻梁宽／颧宽", noseTipWidth: "鼻尖宽／颧宽", nostrilWidth: "鼻翼宽／颧宽" };
    const basePosition = frontNosePosition(sourceFace, width, height);
    for (let iteration = 1; iteration <= 6; iteration++) {
        progress(`正在变形并复核正面比例（${iteration}/6）…`);
        // Give the interface a frame before synchronous pixel work.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const pixels = context.createImageData(width, height);
        pixels.data.set(warpFacePixels(original.data, width, height, controls));
        context.putImageData(pixels, 0, 0);
        const { image: output, blob } = await canvasImage(canvas);
        const detected = await detectFrontFaceGuide(output, "whole");
        const after = frontGuideRatios(detected.face, width, height);
        const pixelTracks = trackGuidePixels(original.data, pixels.data, width, height, wanted, [...Object.values(GUIDE_NOSE_PAIRS).flat(), 1]);
        const pixelCheckPassed = Array.from(pixelTracks.values()).every(track => track.reliable);
        const checks: FaceGuideCheck[] = (Object.keys(before) as Array<keyof typeof before>).map(key => {
            const target = m[key] / m.cheekWidth * 100;
            const detectorEstimate = after[key] / before[key] * 100;
            const pair = GUIDE_NOSE_PAIRS[key as keyof typeof GUIDE_NOSE_PAIRS];
            if (pair) {
                const trackedWidth = pixelTracks.get(pair[1])!.point.x - pixelTracks.get(pair[0])!.point.x;
                const sourceWidth = (sourceFace[pair[1]].x - sourceFace[pair[0]].x) * width;
                const cheekChange = (detected.face[454].x - detected.face[234].x) / (sourceFace[454].x - sourceFace[234].x);
                const observed = trackedWidth / sourceWidth / cheekChange * 100;
                return { key, label: labels[key], target, observed, detectorEstimate, error: Math.abs(observed / target - 1) };
            }
            return { key, label: labels[key], target, observed: detectorEstimate, error: Math.abs(detectorEstimate / target - 1) };
        });
        if (Math.abs(m.noseTipHeight) > .01) {
            const detectorEstimate = (frontNosePosition(detected.face, width, height).tipY - basePosition.tipY) / basePosition.length * 100;
            const eyeY = (detected.face[33].y + detected.face[133].y + detected.face[362].y + detected.face[263].y) / 4 * height;
            const observed = (pixelTracks.get(1)!.point.y - eyeY - basePosition.tipY) / basePosition.length * 100;
            checks.push({ key: "noseTipHeight", label: "鼻尖上下位移（向下为正）", target: m.noseTipHeight,
                observed, detectorEstimate, error: Math.abs(observed - m.noseTipHeight), unit: "position" });
        }
        const verified = pixelCheckPassed && checks.every(item => Number.isFinite(item.error) && item.error <= (item.unit === "position" ? 1 : .05));
        if (verified || iteration === 6) {
            const noseWidth = (sourceFace[358].x - sourceFace[129].x) * width;
            const x = Math.max(0, Math.floor(sourceFace[129].x * width - noseWidth * .45));
            const y = Math.max(0, Math.floor(sourceFace[168].y * height - noseWidth * .15));
            const cropWidth = Math.min(width - x, Math.ceil(noseWidth * 1.9));
            const cropHeight = Math.min(height - y, Math.ceil(sourceFace[2].y * height - y + noseWidth * .3));
            const crop = document.createElement("canvas"); crop.width = cropWidth; crop.height = cropHeight;
            const ctx = crop.getContext("2d")!;
            ctx.drawImage(canvas, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
            const guideCrop = (await canvasImage(crop)).blob;
            context.putImageData(original, 0, 0);
            ctx.drawImage(canvas, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
            const originalCrop = (await canvasImage(crop)).blob;
            return { blob, sourceFaceHeight, verified, iterations: iteration, checks, pixelCheckPassed,
                noseComparison: { original: originalCrop, guide: guideCrop },
                omitted: measurements.filter(item => item.target !== item.baseline && !GUIDE_KEYS.includes(item.key)).map(item => item.label) };
        }
        controls = correctGuideControls(controls, wanted, detected.face, width, height);
    }
    throw new Error("骨相引导复核未完成");
}
