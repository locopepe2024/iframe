import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { imageFaceMetrics, type FaceFitLandmarks, type FaceFitPoint } from "./whiteFaceFit";
import { facePointInSource, frontReferenceBounds, renderFaceCrop, squareCropBounds, squareFaceCrop, type FrontReferenceRegion, type PreparedFaceImage } from "./whiteFaceImage";
import { FACE_FIT_IMAGE_SPEC } from "./whiteFaceImage";
import { validateFacePhotoView, validateProfilePose } from "./faceReferencePair";

const MODEL_ROOT = "/models/character/face-landmarker-v1";
type FaceResult = NormalizedLandmark[];
export type DetectFace = (canvas: HTMLCanvasElement) => FaceResult | undefined;

function mapped(face: FaceResult, index: number, start: number, end: number, top: number, bottom: number): FaceFitPoint {
    const point = face[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("识别结果缺少面部关键点");
    return { x: start + point.x * (end - start), y: top + point.y * (bottom - top) };
}

function eyeCenter(face: FaceResult, corners: [number, number], range: [number, number], verticalRange: [number, number]): FaceFitPoint {
    const a = mapped(face, corners[0], ...range, ...verticalRange);
    const b = mapped(face, corners[1], ...range, ...verticalRange);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function mapDetectedFaces(front: FaceResult | undefined, side: FaceResult | undefined, frontRange: [number, number],
    sideRange: [number, number], aspect: number, verticalRange: [number, number] = [0, 1]): Partial<FaceFitLandmarks> {
    const points: Partial<FaceFitLandmarks> = {};
    if (front) Object.assign(points, {
        frontLeftCheek: mapped(front, 234, ...frontRange, ...verticalRange),
        frontRightCheek: mapped(front, 454, ...frontRange, ...verticalRange),
        frontLeftJaw: mapped(front, 172, ...frontRange, ...verticalRange),
        frontRightJaw: mapped(front, 397, ...frontRange, ...verticalRange),
        frontLeftEye: eyeCenter(front, [33, 133], frontRange, verticalRange),
        frontRightEye: eyeCenter(front, [362, 263], frontRange, verticalRange),
        frontChin: mapped(front, 152, ...frontRange, ...verticalRange),
    });
    if (side) {
        // The far eye collapses under profile projection. Compare horizontal
        // corner separation, independent of mirroring.
        const width = (a: number, b: number) => Math.abs(
            mapped(side, a, ...sideRange, ...verticalRange).x - mapped(side, b, ...sideRange, ...verticalRange).x,
        );
        const corners: [number, number] = width(33, 133) > width(362, 263) ? [33, 133] : [362, 263];
        Object.assign(points, {
            sideEye: eyeCenter(side, corners, sideRange, verticalRange),
            sideNose: mapped(side, 1, ...sideRange, ...verticalRange),
            // 199 is on the anterior chin; 152 is the inferior chin contour.
            sideChin: mapped(side, 199, ...sideRange, ...verticalRange),
        });
    }
    if (front && side) imageFaceMetrics(points as FaceFitLandmarks, aspect);
    return points;
}

export function prepareAndMarkThreeView(image: HTMLImageElement, detect: DetectFace,
    onPrepared?: (images: PreparedFaceImage[]) => void, views: ReadonlyArray<"front" | "side"> = ["front", "side"]): Partial<FaceFitLandmarks> {
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error("三视图尚未加载完成");
    const prepared: PreparedFaceImage[] = [];
    const points: Partial<FaceFitLandmarks> = {};
    const faceOval = Array.from(new Set(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.flatMap(edge => [edge.start, edge.end])));
    for (const [view, start, end] of [["front", 0, .34], ["side", .35, .66]] as const) {
        if (!views.includes(view)) continue;
        let preview: PreparedFaceImage | undefined;
        for (const bottom of [.35, 1]) {
            const region = { x: start * width, y: 0, width: (end - start) * width, height: bottom * height };
            const bounds = squareCropBounds(region);
            const located = detect(renderFaceCrop(image, region));
            if (!located) continue;
            const originalFace = located.map(point => ({ ...point, ...facePointInSource(point, bounds, width, height) }));
            const { crop, sourceFaceHeight } = squareFaceCrop(faceOval.map(index => originalFace[index]), width, height);
            const canvas = renderFaceCrop(image, crop);
            const finalFace = detect(canvas);
            preview = { view, canvas, crop, sourceFaceHeight, detected: !!finalFace };
            // A head-only sheet can be truncated by the coarse upper region.
            // Retry locating the whole column, always requiring final detection.
            if (!finalFace) continue;
            const original = finalFace.map(point => ({ ...point, ...facePointInSource(point, crop, width, height) }));
            Object.assign(points, mapDetectedFaces(view === "front" ? original : undefined, view === "side" ? original : undefined,
                [0, 1], [0, 1], width / height));
            break;
        }
        if (preview) prepared.push(preview);
    }
    onPrepared?.(prepared);
    if (!Object.keys(points).length) throw new Error("处理后未识别到正面或侧面人脸，请核对裁剪预览或手动标记");
    if (points.frontLeftCheek && points.sideEye) imageFaceMetrics(points as FaceFitLandmarks, width / height);
    return points;
}

export async function autoMarkThreeView(image: HTMLImageElement, options?: {
    onPrepared?: (images: PreparedFaceImage[]) => void;
    views?: ReadonlyArray<"front" | "side">;
}): Promise<Partial<FaceFitLandmarks>> {
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("三视图尚未加载完成");
    const vision = await FilesetResolver.forVisionTasks(MODEL_ROOT);
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${MODEL_ROOT}/face_landmarker.task`, delegate: "CPU" },
        runningMode: "IMAGE", numFaces: 1,
    });
    try {
        const detect: DetectFace = canvas => landmarker.detect(canvas).faceLandmarks[0];
        return prepareAndMarkThreeView(image, detect, options?.onPrepared, options?.views);
    } finally {
        landmarker.close();
    }
}

export function prepareAndMarkFrontReference(image: HTMLImageElement, region: FrontReferenceRegion,
    detect: (canvas: HTMLCanvasElement) => FaceResult[], onPrepared?: (images: PreparedFaceImage[]) => void): Partial<FaceFitLandmarks> {
    const width = image.naturalWidth, height = image.naturalHeight;
    const bounds = frontReferenceBounds(width, height, region);
    const located = detect(renderFaceCrop(image, bounds));
    if (located.length > 1) throw new Error("参考区域包含多张人脸，请选择正脸所在的左半图或右半图，或手动标记");
    if (!located.length) throw new Error("参考区域未识别到人脸，请核对正脸区域或手动标记");
    const original = located[0].map(point => ({ ...point, ...facePointInSource(point, squareCropBounds(bounds), width, height) }));
    const oval = Array.from(new Set(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.flatMap(edge => [edge.start, edge.end])));
    const { crop, sourceFaceHeight } = squareFaceCrop(oval.map(index => original[index]), width, height);
    const canvas = renderFaceCrop(image, crop);
    const final = detect(canvas);
    onPrepared?.([{ view: "front", crop, sourceFaceHeight, canvas, detected: final.length === 1 }]);
    if (final.length > 1) throw new Error("裁剪区域包含多张人脸，请调整正脸区域或手动标记");
    if (!final.length) throw new Error("处理后未识别到正脸，请核对裁剪预览或手动标记");
    const mapped = final[0].map(point => ({ ...point, ...facePointInSource(point, crop, width, height) }));
    return mapDetectedFaces(mapped, undefined, [0, 1], [0, 1], width / height);
}

export async function autoMarkFrontReference(image: HTMLImageElement, options: {
    region: FrontReferenceRegion; onPrepared?: (images: PreparedFaceImage[]) => void;
}): Promise<Partial<FaceFitLandmarks>> {
    frontReferenceBounds(image.naturalWidth, image.naturalHeight, options.region);
    const vision = await FilesetResolver.forVisionTasks(MODEL_ROOT);
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${MODEL_ROOT}/face_landmarker.task`, delegate: "CPU" },
        runningMode: "IMAGE", numFaces: 2,
    });
    try {
        return prepareAndMarkFrontReference(image, options.region, canvas => landmarker.detect(canvas).faceLandmarks, options.onPrepared);
    } finally {
        landmarker.close();
    }
}

/** Dense original-image coordinates for local image deformation; no remote inference. */
export async function detectFrontFaceGuide(image: HTMLImageElement, region: FrontReferenceRegion) {
    const vision = await FilesetResolver.forVisionTasks(MODEL_ROOT);
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${MODEL_ROOT}/face_landmarker.task`, delegate: "CPU" },
        runningMode: "IMAGE", numFaces: 2,
    });
    let face: FaceResult | undefined, prepared: PreparedFaceImage | undefined;
    try {
        const marks = prepareAndMarkFrontReference(image, region, canvas => {
            const faces = landmarker.detect(canvas).faceLandmarks;
            face = faces[0];
            return faces;
        }, items => { prepared = items[0]; });
        if (!face || !prepared) throw new Error("正脸识别不完整");
        const original = face.map(point => ({ ...point,
            ...facePointInSource(point, prepared!.crop, image.naturalWidth, image.naturalHeight),
        }));
        validateFacePhotoView(original, "front", image.naturalWidth, image.naturalHeight);
        return { marks, prepared, face: original };
    } finally {
        landmarker.close();
    }
}

/** Whole-image single-view input. Both locating and cropped detection reject multiple faces. */
export function prepareAndMarkFacePhoto(image: HTMLImageElement, view: "front" | "side",
    detect: (canvas: HTMLCanvasElement) => FaceResult[]) {
    const width = image.naturalWidth, height = image.naturalHeight;
    const bounds = frontReferenceBounds(width, height, "whole");
    const one = (canvas: HTMLCanvasElement) => {
        const faces = detect(canvas);
        if (faces.length !== 1) throw new Error(faces.length > 1 ? "每张参考图只能有一个人，请勿使用拼图或三视图排版" : "未识别到清晰人脸，请更换原图");
        return faces[0];
    };
    const located = one(renderFaceCrop(image, bounds));
    const original = located.map(p => ({ ...p, ...facePointInSource(p, squareCropBounds(bounds), width, height) }));
    const oval = Array.from(new Set(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.flatMap(edge => [edge.start, edge.end])));
    const { crop, sourceFaceHeight } = squareFaceCrop(oval.map(i => original[i]), width, height);
    if (sourceFaceHeight < FACE_FIT_IMAGE_SPEC.minimumFaceHeight) throw new Error(`原始人脸高约${Math.round(sourceFaceHeight)}像素，低于128像素，请更换清晰头像`);
    const canvas = renderFaceCrop(image, crop);
    const final = one(canvas).map(p => ({ ...p, ...facePointInSource(p, crop, width, height) }));
    validateFacePhotoView(final, view, width, height);
    const points = mapDetectedFaces(view === "front" ? final : undefined, view === "side" ? final : undefined, [0, 1], [0, 1], width / height);
    const clipped = Object.values(points).some(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1);
    if (clipped) throw new Error("脸部被裁掉，请使用眼睛、鼻尖和下巴完整的原图");
    return { points, face: final, prepared: { view, crop, sourceFaceHeight, canvas, detected: true } };
}

export async function autoMarkFacePhoto(image: HTMLImageElement, view: "front" | "side") {
    const vision = await FilesetResolver.forVisionTasks(MODEL_ROOT);
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${MODEL_ROOT}/face_landmarker.task`, delegate: "CPU" },
        // A stricter detector suppresses an observed ear false positive on cropped profiles.
        runningMode: "IMAGE", numFaces: 2, minFaceDetectionConfidence: 0.7, outputFacialTransformationMatrixes: view === "side",
    });
    try { return prepareAndMarkFacePhoto(image, view, canvas => {
        const result = landmarker.detect(canvas);
        if (view === "side" && result.faceLandmarks.length === 1) validateProfilePose(result.facialTransformationMatrixes[0]);
        return result.faceLandmarks;
    }); }
    finally { landmarker.close(); }
}
