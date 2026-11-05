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

export function mapDetectedFaces(front: FaceResult | undefined, side: FaceResult | undefined, frontRange: [number, number],
    sideRange: [number, number], aspect: number, verticalRange: [number, number] = [0, 1]): Partial<FaceFitLandmarks> {
    const points: Partial<FaceFitLandmarks> = {};
    if (front) Object.assign(points, {
        frontLeftCheek: mapped(front, 234, ...frontRange, ...verticalRange),
        frontRightCheek: mapped(front, 454, ...frontRange, ...verticalRange),
        frontLeftJaw: mapped(front, 172, ...frontRange, ...verticalRange),
        frontRightJaw: mapped(front, 397, ...frontRange, ...verticalRange),
        frontLeftEye: mapped(front, 133, ...frontRange, ...verticalRange),
        frontRightEye: mapped(front, 362, ...frontRange, ...verticalRange),
        frontChin: mapped(front, 152, ...frontRange, ...verticalRange),
    });
    if (side) Object.assign(points, {
        sideEye: mapped(side, 362, ...sideRange, ...verticalRange),
        sideNose: mapped(side, 1, ...sideRange, ...verticalRange),
        sideChin: mapped(side, 152, ...sideRange, ...verticalRange),
    });
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
