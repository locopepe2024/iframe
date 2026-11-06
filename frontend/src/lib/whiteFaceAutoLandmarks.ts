import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { imageFaceMetrics, type FaceFitLandmarks, type FaceFitPoint } from "./whiteFaceFit";

const MODEL_ROOT = "/models/character/face-landmarker-v1";
type FaceResult = NormalizedLandmark[];
type DetectFace = (canvas: HTMLCanvasElement) => FaceResult | undefined;

function crop(image: HTMLImageElement, start: number, end: number, top = 0, bottom = 1): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = Math.max(256, Math.round(512 * image.naturalHeight * (bottom - top) / (image.naturalWidth * (end - start))));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取三视图图像");
    context.drawImage(image, image.naturalWidth * start, image.naturalHeight * top, image.naturalWidth * (end - start),
        image.naturalHeight * (bottom - top), 0, 0, canvas.width, canvas.height);
    return canvas;
}

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

export async function autoMarkThreeView(image: HTMLImageElement): Promise<Partial<FaceFitLandmarks>> {
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("三视图尚未加载完成");
    const vision = await FilesetResolver.forVisionTasks(MODEL_ROOT);
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${MODEL_ROOT}/face_landmarker.task`, delegate: "CPU" },
        runningMode: "IMAGE", numFaces: 1,
    });
    try {
        const detect: DetectFace = canvas => landmarker.detect(canvas).faceLandmarks[0];
        const frontRange: [number, number] = [0, 0.34];
        const sideRange: [number, number] = [0.35, 0.66];
        const headRange: [number, number] = [0, 0.35];
        const fullRange: [number, number] = [0, 1];
        const detectView = (range: [number, number]) => {
            const head = detect(crop(image, ...range, ...headRange));
            return head ? { face: head, verticalRange: headRange } : {
                face: detect(crop(image, ...range)), verticalRange: fullRange,
            };
        };
        const front = detectView(frontRange);
        const side = detectView(sideRange);
        if (!front.face && !side.face) throw new Error("未识别到正面或侧面人脸，请手动标记");
        const aspect = image.naturalWidth / image.naturalHeight;
        const points = {
            ...mapDetectedFaces(front.face, undefined, frontRange, sideRange, aspect, front.verticalRange),
            ...mapDetectedFaces(undefined, side.face, frontRange, sideRange, aspect, side.verticalRange),
        };
        if (front.face && side.face) imageFaceMetrics(points as FaceFitLandmarks, aspect);
        return points;
    } finally {
        landmarker.close();
    }
}
