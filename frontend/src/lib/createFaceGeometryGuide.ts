import { detectFrontFaceGuide } from "./whiteFaceAutoLandmarks";
import { faceGuideControls, warpFacePixels, correctGuideControls, frontGuideRatios, GUIDE_KEYS } from "./faceGeometryGuide";
import { faceShapeMeasurements, type FaceShape } from "./whiteFaceShape";
import { FACE_FIT_IMAGE_SPEC, type FrontReferenceRegion } from "./whiteFaceImage";

export type FaceGuideCheck = { key: string; label: string; target: number; observed: number; error: number };
export type FaceGeometryGuide = {
    blob: Blob; sourceFaceHeight: number; verified: boolean; iterations: number;
    checks: FaceGuideCheck[]; omitted: string[];
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
    const scale = Math.min(1, 1536 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * scale), height = Math.round(image.naturalHeight * scale);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取人脸图像");
    context.drawImage(image, 0, 0, width, height);
    const original = context.getImageData(0, 0, width, height);
    const wanted = faceGuideControls(source.face, shape, width, height);
    let controls = wanted;
    const m = Object.fromEntries(measurements.map(item => [item.key, item.target]));
    const before = frontGuideRatios(source.face, width, height);
    const labels = { faceLength: "脸长／颧宽", jawWidth: "下颌宽／颧宽", eyeSpacing: "眼距／颧宽" };
    for (let iteration = 1; iteration <= 6; iteration++) {
        progress(`正在变形并复核正面比例（${iteration}/6）…`);
        // Give the interface a frame before synchronous pixel work.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const pixels = context.createImageData(width, height);
        pixels.data.set(warpFacePixels(original.data, width, height, controls));
        context.putImageData(pixels, 0, 0);
        const { image: output, blob } = await canvasImage(canvas);
        const detected = await detectFrontFaceGuide(output, region);
        const after = frontGuideRatios(detected.face, width, height);
        const checks = (Object.keys(before) as Array<keyof typeof before>).map(key => {
            const target = m[key] / m.cheekWidth * 100, observed = after[key] / before[key] * 100;
            return { key, label: labels[key], target, observed, error: Math.abs(observed / target - 1) };
        });
        const verified = checks.every(item => Number.isFinite(item.error) && item.error <= .05);
        if (verified || iteration === 6) return { blob, sourceFaceHeight, verified, iterations: iteration, checks,
            omitted: measurements.filter(item => item.target !== item.baseline && !GUIDE_KEYS.includes(item.key)).map(item => item.label) };
        controls = correctGuideControls(controls, wanted, detected.face, width, height);
    }
    throw new Error("骨相引导复核未完成");
}
