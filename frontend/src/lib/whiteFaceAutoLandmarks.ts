import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { imageFaceMetrics, type FaceFitLandmarks, type FaceFitPoint } from "./whiteFaceFit";

const MODEL_ROOT = "/models/character/face-landmarker-v1";
type FaceResult = NormalizedLandmark[];
type DetectFace = (canvas: HTMLCanvasElement) => FaceResult | undefined;

function crop(image: HTMLImageElement, start: number, end: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = Math.max(256, Math.round(512 * image.naturalHeight / (image.naturalWidth * (end - start))));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取三视图图像");
    context.drawImage(image, image.naturalWidth * start, 0, image.naturalWidth * (end - start),
        image.naturalHeight, 0, 0, canvas.width, canvas.height);
    return canvas;
}

function mapped(face: FaceResult, index: number, start: number, end: number): FaceFitPoint {
    const point = face[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("识别结果缺少面部关键点");
    return { x: start + point.x * (end - start), y: point.y };
}

export function mapDetectedFaces(front: FaceResult, side: FaceResult, frontRange: [number, number],
    sideRange: [number, number], aspect: number): FaceFitLandmarks {
    const frontLeftCheek = mapped(front, 234, ...frontRange);
    const frontRightCheek = mapped(front, 454, ...frontRange);
    const frontLeftJaw = mapped(front, 172, ...frontRange);
    const frontRightJaw = mapped(front, 397, ...frontRange);
    const frontLeftEye = mapped(front, 133, ...frontRange);
    const frontRightEye = mapped(front, 362, ...frontRange);
    const sideEye = mapped(side, 362, ...sideRange);
    const points = {
        frontLeftCheek, frontRightCheek, frontLeftJaw, frontRightJaw, frontLeftEye, frontRightEye,
        frontChin: mapped(front, 152, ...frontRange), sideEye,
        sideNose: mapped(side, 1, ...sideRange), sideChin: mapped(side, 152, ...sideRange),
    };
    imageFaceMetrics(points, aspect);
    return points;
}

export async function autoMarkThreeView(image: HTMLImageElement): Promise<FaceFitLandmarks> {
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
        const front = detect(crop(image, ...frontRange));
        const side = detect(crop(image, ...sideRange));
        if (!front || !side) throw new Error("未能同时识别正面和侧面，请手动补齐标记");
        return mapDetectedFaces(front, side, frontRange, sideRange, image.naturalWidth / image.naturalHeight);
    } finally {
        landmarker.close();
    }
}
